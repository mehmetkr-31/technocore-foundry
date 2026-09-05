import {
  didFromPublicKey,
  publicKeyFromDid,
  sha256Hex,
  sweepTechnocoreText,
  verifyTechnocoreMessage,
  verifyTechnocoreNote,
  type TechnocoreSignedMessage,
  type TechnocoreSignedNote,
} from './foundry-crypto';
import {
  assertTechnocoreRoomName,
  TECHNOCORE_ADAPTER_VERSION,
  TECHNOCORE_EXPORT_GENERATION_HEADER,
  TECHNOCORE_LIVE_AGENT_SHA256,
  TECHNOCORE_LIVE_CONFIG_SHA256,
  TECHNOCORE_LIVE_OPENAPI_SHA256,
  TECHNOCORE_NONCE_PATTERN,
  TECHNOCORE_NOTE_LIMIT,
  TECHNOCORE_OPERATIONAL_COMMIT,
  TECHNOCORE_ORIGIN,
  TECHNOCORE_SIGNATURE_PATTERN,
  ownedTechnocoreRoom,
} from './technocore-contract';
import {
  parseTechnocoreAcknowledgement,
  technocoreProfileLocation,
  TECHNOCORE_EXPORT_MAX_BYTES,
  verifyTechnocoreExport,
} from './technocore-records';
import { decodeStrictUtf8, parseLosslessIntegerJsonBytes, parseStrictJsonBytes } from './strict-json';

const REQUEST_LIMIT = 32 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const CONFIRMATION = 'publish_to_technocore';

export type TechnocoreReadinessDependencies = {
  upstreamFetch: typeof fetch;
  now?: () => Date;
  compatibility?: () => Promise<LiveTechnocoreStatus>;
};

export type LiveTechnocoreStatus = {
  state: 'compatible' | 'incompatible' | 'offline';
  supportedVersion: string;
  liveVersion: string | null;
  supportedCommit: string;
  openapiSha256: string | null;
  configSha256: string | null;
  agentSha256: string | null;
  openapiMatch: boolean;
  configMatch: boolean;
  agentMatch: boolean;
  writesEnabled: boolean;
  reason: string;
};

class InputTooLargeError extends Error {}

function localOrigin(request: Request, allowMissingOrigin = false) {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  const localHost = requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === '[::1]' || requestUrl.hostname === '::1';
  const origin = request.headers.get('origin');
  return localHost && (origin === requestUrl.origin || (allowMissingOrigin && origin === null));
}

async function boundedBody(request: Request, maximum = REQUEST_LIMIT) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new InputTooLargeError('Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function boundedResponse(response: Response, maximum = RESPONSE_LIMIT) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maximum) throw new Error('Technocore response exceeds the bounded adapter limit.');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error('Technocore response exceeds the bounded adapter limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function exactObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function mediaType(response: Response) {
  return response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

function requireMediaType(response: Response, expected: string, label: string) {
  if (mediaType(response) !== expected) throw new Error(`${label} returned an unexpected content type.`);
}

function canonicalDid(value: unknown) {
  if (typeof value !== 'string') throw new Error('A canonical Ed25519 did:key is required.');
  const key = publicKeyFromDid(value);
  if (didFromPublicKey(key) !== value) throw new Error('A canonical Ed25519 did:key is required.');
  return value;
}

async function upstream(url: string, init: RequestInit, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'technocore-foundry-readiness/1.0',
      ...(init.headers ?? {}),
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Technocore redirect was refused.');
  }
  return response;
}

async function liveStatus(fetcher: typeof fetch): Promise<LiveTechnocoreStatus> {
  try {
    const [configResponse, openapiResponse, agentResponse] = await Promise.all([
      upstream(`${TECHNOCORE_ORIGIN}/config`, {}, fetcher),
      upstream(`${TECHNOCORE_ORIGIN}/openapi.json`, {}, fetcher),
      upstream(`${TECHNOCORE_ORIGIN}/.well-known/agent.json`, {}, fetcher),
    ]);
    if (!configResponse.ok || !openapiResponse.ok || !agentResponse.ok) throw new Error('Technocore compatibility endpoints did not answer successfully.');
    requireMediaType(configResponse, 'application/json', 'Technocore config');
    requireMediaType(openapiResponse, 'application/json', 'Technocore OpenAPI');
    requireMediaType(agentResponse, 'application/json', 'Technocore agent card');
    const [configBytes, openapiBytes, agentBytes] = await Promise.all([
      boundedResponse(configResponse),
      boundedResponse(openapiResponse),
      boundedResponse(agentResponse),
    ]);
    // Operational config contains fractional values (for example wait_poll: 0.5).
    // It is not a signed protocol payload. Decode it for display only; compatibility
    // still requires the SHA-256 of all three exact documents to match reviewed bytes.
    // Signed messages, notes and receipt parsing keep their integer-only rules.
    const config: unknown = JSON.parse(decodeStrictUtf8(configBytes));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Technocore config is malformed.');
    const liveVersion = typeof (config as Record<string, unknown>).version === 'string' ? String((config as Record<string, unknown>).version) : null;
    const [configDigest, openapiDigest, agentDigest] = await Promise.all([
      sha256Hex(configBytes),
      sha256Hex(openapiBytes),
      sha256Hex(agentBytes),
    ]);
    const configMatch = configDigest === TECHNOCORE_LIVE_CONFIG_SHA256;
    const openapiMatch = openapiDigest === TECHNOCORE_LIVE_OPENAPI_SHA256;
    const agentMatch = agentDigest === TECHNOCORE_LIVE_AGENT_SHA256;
    const compatible = liveVersion === TECHNOCORE_ADAPTER_VERSION && configMatch && openapiMatch && agentMatch;
    return {
      state: compatible ? 'compatible' : 'incompatible',
      supportedVersion: TECHNOCORE_ADAPTER_VERSION,
      liveVersion,
      supportedCommit: TECHNOCORE_OPERATIONAL_COMMIT,
      openapiSha256: openapiDigest,
      configSha256: configDigest,
      agentSha256: agentDigest,
      openapiMatch,
      configMatch,
      agentMatch,
      writesEnabled: compatible,
      reason: compatible
        ? 'Live version, config, OpenAPI, and agent-card digests match the reviewed adapter.'
        : 'Live protocol evidence drifted from the reviewed adapter. Writes are fail-closed until a reviewed update lands.',
    };
  } catch {
    return {
      state: 'offline',
      supportedVersion: TECHNOCORE_ADAPTER_VERSION,
      liveVersion: null,
      supportedCommit: TECHNOCORE_OPERATIONAL_COMMIT,
      openapiSha256: null,
      configSha256: null,
      agentSha256: null,
      openapiMatch: false,
      configMatch: false,
      agentMatch: false,
      writesEnabled: false,
      reason: 'Live compatibility could not be established. Writes remain disabled.',
    };
  }
}

async function requireCompatible(dependencies: TechnocoreReadinessDependencies) {
  const status = await (dependencies.compatibility ? dependencies.compatibility() : liveStatus(dependencies.upstreamFetch));
  if (!status.writesEnabled) throw new Error(status.reason);
  return status;
}

function parseSignedMessage(value: unknown): TechnocoreSignedMessage {
  if (!exactObject(value, ['room', 'did', 'sig', 'nonce', 'text'])) throw new Error('Signed message has an unexpected shape.');
  const input = value as Record<string, unknown>;
  const room = assertTechnocoreRoomName(String(input.room));
  const did = canonicalDid(input.did);
  if (typeof input.sig !== 'string' || !TECHNOCORE_SIGNATURE_PATTERN.test(input.sig)) throw new Error('Signed message signature is not canonical.');
  if (typeof input.nonce !== 'string' || !TECHNOCORE_NONCE_PATTERN.test(input.nonce)) throw new Error('Signed message nonce is not canonical.');
  if (typeof input.text !== 'string' || input.text !== sweepTechnocoreText(input.text)) throw new Error('Signed message text is not in stored protocol form.');
  return { room, did, sig: input.sig, nonce: input.nonce, text: input.text };
}

function parseSignedNote(value: unknown): TechnocoreSignedNote {
  if (!exactObject(value, ['namespace', 'key', 'did', 'sig', 'nonce', 'value'])) throw new Error('Signed note has an unexpected shape.');
  const input = value as Record<string, unknown>;
  if (input.namespace !== 'room-owners' && input.namespace !== 'room-allow') throw new Error('Only ownership note namespaces are signed.');
  const key = ownedTechnocoreRoom(String(input.key));
  const did = canonicalDid(input.did);
  if (typeof input.sig !== 'string' || !TECHNOCORE_SIGNATURE_PATTERN.test(input.sig)) throw new Error('Signed note signature is not canonical.');
  if (typeof input.nonce !== 'string' || !TECHNOCORE_NONCE_PATTERN.test(input.nonce)) throw new Error('Signed note nonce is not canonical.');
  if (typeof input.value !== 'string' || input.value !== sweepTechnocoreText(input.value, TECHNOCORE_NOTE_LIMIT)) throw new Error('Signed note value is not in stored protocol form.');
  return { namespace: input.namespace, key, did, sig: input.sig, nonce: input.nonce, value: input.value };
}

async function readNote(namespace: string, key: string, fetcher: typeof fetch) {
  const response = await upstream(`${TECHNOCORE_ORIGIN}/kv/${namespace}/${key}`, {}, fetcher);
  const bytes = await boundedResponse(response, 32 * 1024);
  if (response.status === 404) return { exists: false as const, value: null };
  if (!response.ok) throw new Error(`Technocore note read failed with ${response.status}.`);
  requireMediaType(response, 'text/plain', 'Technocore note read');
  const text = decodeStrictUtf8(bytes);
  const split = text.indexOf('\n\n');
  if (split < 0) throw new Error('Technocore note response is malformed.');
  const value = text.slice(split + 2).split('\n# budget:', 1)[0].trimEnd();
  return { exists: true as const, value };
}

async function readRoom(room: string, fetcher: typeof fetch) {
  const response = await upstream(`${TECHNOCORE_ORIGIN}/r/${room}?format=json&limit=1`, {}, fetcher);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 404) return { exists: false as const, room, generation: null, lastSeq: 0, latestTimestamp: null };
    throw new Error(`Technocore room read failed with ${response.status}.`);
  }
  requireMediaType(response, 'application/json', 'Technocore room read');
  const parsed = parseLosslessIntegerJsonBytes(await boundedResponse(response));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Technocore room view is malformed.');
  const view = parsed as Record<string, unknown>;
  if (view.room !== room || !Number.isSafeInteger(view.generation) || !Number.isSafeInteger(view.last_seq) || !Array.isArray(view.messages)) {
    throw new Error('Technocore room view is incompatible with the reviewed adapter.');
  }
  const latest = view.messages.at(-1);
  const latestTimestamp = latest && typeof latest === 'object' && !Array.isArray(latest) && typeof (latest as Record<string, unknown>).ts === 'string'
    ? String((latest as Record<string, unknown>).ts)
    : null;
  return { exists: Number(view.last_seq) > 0, room, generation: Number(view.generation), lastSeq: Number(view.last_seq), latestTimestamp };
}

async function readRoomExport(room: string, fetcher: typeof fetch) {
  const response = await upstream(`${TECHNOCORE_ORIGIN}/r/${room}/export`, { headers: { Accept: 'application/x-ndjson' } }, fetcher);
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Technocore export failed with ${response.status}.`);
  }
  requireMediaType(response, 'application/x-ndjson', 'Technocore room export');
  const bytes = await boundedResponse(response, TECHNOCORE_EXPORT_MAX_BYTES);
  const generation = response.headers.get(TECHNOCORE_EXPORT_GENERATION_HEADER);
  if (!generation || !/^\d+$/.test(generation) || !Number.isSafeInteger(Number(generation)) || Number(generation) < 0) {
    throw new Error('Technocore export omitted a safe generation header.');
  }
  return { bytes, generation: Number(generation) };
}

export async function handleTechnocoreReadinessGet(request: Request, dependencies: TechnocoreReadinessDependencies) {
  if (!localOrigin(request, true)) return Response.json({ error: 'Technocore readiness network access is available only from the loopback-local Foundry origin.' }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  try {
    if (kind === 'status') return Response.json(await liveStatus(dependencies.upstreamFetch), { headers: { 'Cache-Control': 'no-store' } });
    if (kind === 'profile') {
      const did = canonicalDid(url.searchParams.get('did'));
      const location = await technocoreProfileLocation(did);
      return Response.json({ ...location, ...(await readNote(location.namespace, location.key, dependencies.upstreamFetch)) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (kind === 'room') {
      const room = assertTechnocoreRoomName(url.searchParams.get('room') ?? '');
      return Response.json(await readRoom(room, dependencies.upstreamFetch), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (kind === 'ownership') {
      const room = ownedTechnocoreRoom(url.searchParams.get('room') ?? '');
      const [owner, allow, nonce, roomState] = await Promise.all([
        readNote('room-owners', room, dependencies.upstreamFetch),
        readNote('room-allow', room, dependencies.upstreamFetch),
        readNote('room-nonce', room, dependencies.upstreamFetch),
        readRoom(room, dependencies.upstreamFetch),
      ]);
      return Response.json({ room, owner, allow, nonce, roomState }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (kind === 'message_nonce') {
      const room = assertTechnocoreRoomName(url.searchParams.get('room') ?? '');
      const did = canonicalDid(url.searchParams.get('did'));
      const exported = await readRoomExport(room, dependencies.upstreamFetch);
      if (!exported) return Response.json({ room, did, generation: null, nonce: null }, { headers: { 'Cache-Control': 'no-store' } });
      const report = await verifyTechnocoreExport(exported.bytes, room);
      const authored = report.records.filter((record) => record.from === did && record.nonce !== null);
      if (authored.some((record) => record.signatureState === 'invalid')) {
        throw new Error('A retained record for this DID failed signature verification; message signing is blocked.');
      }
      const nonce = authored.reduce<string | null>((highest, record) => (
        highest === null || BigInt(record.nonce!) > BigInt(highest) ? record.nonce : highest
      ), null);
      return Response.json({ room, did, generation: exported.generation, nonce }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (kind === 'export') {
      const room = assertTechnocoreRoomName(url.searchParams.get('room') ?? '');
      const exported = await readRoomExport(room, dependencies.upstreamFetch);
      if (!exported) return Response.json({ error: 'Technocore room export does not exist.' }, { status: 404 });
      return new Response(exported.bytes, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': `attachment; filename="${room}.generation-${exported.generation}.jsonl"`,
          [TECHNOCORE_EXPORT_GENERATION_HEADER]: String(exported.generation),
        },
      });
    }
    return Response.json({ error: 'Unknown readiness read operation.' }, { status: 400 });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : 'Technocore read failed safely.' }, { status: 502 });
  }
}

export async function handleTechnocoreReadinessPost(request: Request, dependencies: TechnocoreReadinessDependencies) {
  if (!localOrigin(request)) return Response.json({ error: 'Technocore writes are available only from the loopback-local Foundry origin.' }, { status: 403 });
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return Response.json({ error: 'Technocore readiness writes accept application/json only.' }, { status: 415 });
  }
  let input: unknown;
  try {
    input = parseStrictJsonBytes(await boundedBody(request));
  } catch (cause) {
    return Response.json({ error: 'Expected a bounded strict-JSON request.' }, { status: cause instanceof InputTooLargeError ? 413 : 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return Response.json({ error: 'Expected a request object.' }, { status: 400 });
  const payload = input as Record<string, unknown>;
  if (payload.confirmation !== CONFIRMATION) return Response.json({ error: 'Explicit Technocore publication confirmation is required.' }, { status: 400 });
  try {
    await requireCompatible(dependencies);
    if (payload.action === 'publish_message' && exactObject(payload, ['action', 'confirmation', 'message'])) {
      const message = parseSignedMessage(payload.message);
      if (!(await verifyTechnocoreMessage(message))) throw new Error('Signed message verification failed locally.');
      const response = await upstream(`${TECHNOCORE_ORIGIN}/r/${message.room}?format=json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: message.did, sig: message.sig, nonce: message.nonce, text: message.text }),
      }, dependencies.upstreamFetch);
      const bytes = await boundedResponse(response);
      if (!response.ok) throw new Error(`Technocore rejected the signed message with ${response.status}.`);
      requireMediaType(response, 'application/json', 'Technocore signed-message acknowledgement');
      const proof = await parseTechnocoreAcknowledgement(bytes, message, (dependencies.now ?? (() => new Date()))().toISOString());
      return Response.json({ status: 'published', proof }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (payload.action === 'publish_profile' && exactObject(payload, ['action', 'confirmation', 'did', 'value', 'previousValue'])) {
      const did = canonicalDid(payload.did);
      if (typeof payload.value !== 'string') throw new Error('Profile note must be a string.');
      const value = sweepTechnocoreText(payload.value, TECHNOCORE_NOTE_LIMIT);
      if (payload.previousValue !== null && typeof payload.previousValue !== 'string') throw new Error('Profile compare-and-set value is invalid.');
      const location = await technocoreProfileLocation(did);
      const condition = payload.previousValue === null ? { if_absent: true } : { if: payload.previousValue };
      const response = await upstream(`${TECHNOCORE_ORIGIN}/kv/${location.namespace}/${location.key}?format=json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, ...condition }),
      }, dependencies.upstreamFetch);
      const bytes = await boundedResponse(response);
      if (!response.ok) throw new Error(`Technocore rejected the profile note with ${response.status}; refresh before retrying.`);
      requireMediaType(response, 'application/json', 'Technocore profile acknowledgement');
      return Response.json({ status: 'published', location, value, upstream: parseStrictJsonBytes(bytes), warning: 'Profile notes are unsigned and world-writable routing hints.' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (payload.action === 'publish_signed_note' && exactObject(payload, ['action', 'confirmation', 'operation', 'note'])) {
      if (!['claim', 'allow', 'transfer'].includes(String(payload.operation))) throw new Error('Unknown owned-room operation.');
      const note = parseSignedNote(payload.note);
      if (!(await verifyTechnocoreNote(note))) throw new Error('Signed ownership note verification failed locally.');
      if (payload.operation === 'claim' && (note.namespace !== 'room-owners' || note.value !== note.did)) throw new Error('Initial room claim must store the signing DID as owner.');
      if (payload.operation === 'allow') {
        if (note.namespace !== 'room-allow') throw new Error('Allow-list operation must use room-allow.');
        const entries = note.value.split(/\s+/);
        if (!entries.length) throw new Error('Allow-list must contain at least one canonical DID.');
        entries.forEach(canonicalDid);
        if (new Set(entries).size !== entries.length) throw new Error('Allow-list must not contain duplicate DIDs.');
      }
      if (payload.operation === 'transfer') {
        if (note.namespace !== 'room-owners') throw new Error('Transfer must update room-owners.');
        canonicalDid(note.value);
      }
      const body = {
        did: note.did,
        sig: note.sig,
        nonce: note.nonce,
        value: note.value,
        ...(payload.operation === 'claim' ? { if_absent: true } : {}),
      };
      const response = await upstream(`${TECHNOCORE_ORIGIN}/kv/${note.namespace}/${note.key}?format=json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, dependencies.upstreamFetch);
      const bytes = await boundedResponse(response);
      if (!response.ok) throw new Error(`Technocore rejected the owned-room operation with ${response.status}; refresh the owner and nonce before retrying.`);
      requireMediaType(response, 'application/json', 'Technocore owned-room acknowledgement');
      return Response.json({ status: 'published', operation: payload.operation, room: note.key, nonce: note.nonce, upstream: parseStrictJsonBytes(bytes) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: 'Unknown or malformed readiness write operation.' }, { status: 400 });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : 'Technocore write failed safely.' }, { status: 502 });
  }
}

export const TECHNOCORE_READINESS_CONFIRMATION = CONFIRMATION;
