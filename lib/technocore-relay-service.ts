import type { RelayAttemptStore, TechnocoreRelayAttempt } from '@/db/technocore-relay-attempts';
import {
  canonicalJson,
  sha256Hex,
  type TechnocoreSignedMessage,
} from '@/lib/foundry-crypto';
import { parseLosslessIntegerJsonBytes, parseStrictJsonBytes } from '@/lib/strict-json';
import {
  assertPublicReceiptAnnouncement,
  type RelayConfiguration,
} from '@/lib/technocore-relay-policy';

export const FOUNDRY_TECHNOCORE_ROOM = 'foundry-contributions' as const;
export const FOUNDRY_TECHNOCORE_ENDPOINT = `https://technocore.chat/r/${FOUNDRY_TECHNOCORE_ROOM}?format=json` as const;
export const FOUNDRY_TECHNOCORE_ACK_SOURCE_COMMIT = '16a6128bea125c8f131f343c0e8430dfc110f4af' as const;

type RelayResult = {
  id: string;
  missionId: string;
  claimId: string;
  actorDid: string;
  receiptJson: string;
  artifactSha256: string;
  acceptanceDecision: 'accepted' | 'rejected' | null;
};

export type TechnocoreRelayDependencies = {
  verifyMessage(message: TechnocoreSignedMessage): Promise<boolean>;
  verifyResultReceipt(receipt: unknown): Promise<boolean>;
  findPublishableResult(id: string): Promise<RelayResult | null>;
  attempts: RelayAttemptStore;
  upstreamFetch: typeof fetch;
  now?: () => Date;
};

class RequestBodyTooLargeError extends Error {}

function compactDid(did: string) {
  return `${did.slice(8, 16)}…${did.slice(-6)}`;
}

function looksLikeMessage(value: unknown): value is TechnocoreSignedMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Partial<TechnocoreSignedMessage>;
  return Boolean(
    Object.keys(value).length === 5 &&
    ['room', 'did', 'sig', 'nonce', 'text'].every((key) => Object.hasOwn(value, key)) &&
    message.room === FOUNDRY_TECHNOCORE_ROOM &&
    typeof message.did === 'string' && message.did.length <= 160 &&
    typeof message.sig === 'string' && /^[A-Za-z0-9_-]{86}$/.test(message.sig) &&
    typeof message.nonce === 'string' && /^\d{1,19}$/.test(message.nonce) &&
    BigInt(message.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) &&
    typeof message.text === 'string' && message.text.length >= 30 && message.text.length <= 4096
  );
}

async function boundedRequestBytes(request: Request, maximum = 8192) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new RequestBodyTooLargeError('request body too large');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function boundedResponseBytes(response: Response, maximum = 512 * 1024) {
  if (!response.body) throw new Error('upstream response body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error('upstream response body is too large');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function assertPublishedAcknowledgement(value: unknown, message: TechnocoreSignedMessage) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('upstream JSON must be an object');
  const response = value as Record<string, unknown>;
  const posted = response.posted;
  if (response.room !== FOUNDRY_TECHNOCORE_ROOM || !posted || typeof posted !== 'object' || Array.isArray(posted)) {
    throw new Error('upstream JSON does not identify the fixed room and posted record');
  }
  const record = posted as Record<string, unknown>;
  if (
    Object.keys(record).length !== 6 ||
    !['seq', 'ts', 'from', 'text', 'nonce', 'sig'].every((key) => Object.hasOwn(record, key)) ||
    !Number.isSafeInteger(record.seq) || Number(record.seq) < 1 ||
    typeof record.ts !== 'string' || record.ts.length > 64 || !Number.isFinite(Date.parse(record.ts)) ||
    record.from !== message.did || record.text !== message.text || record.sig !== message.sig ||
    !Number.isSafeInteger(record.nonce) || Number(record.nonce) < 0 ||
    String(record.nonce) !== BigInt(message.nonce).toString()
  ) throw new Error('upstream posted record does not bind the signed announcement');
  return { seq: Number(record.seq) };
}

function lockedResponse(attempt: TechnocoreRelayAttempt | null, code: string) {
  if (attempt?.state === 'published') {
    return Response.json({ status: 'already_published', code, upstreamStatus: attempt.upstreamStatus, attempt: attempt.envelopeSha256 }, { status: 200 });
  }
  if (attempt?.state === 'rejected') {
    return Response.json({ error: 'This signed attempt was already rejected. Sign a new package with a higher nonce.', code: 'previously_rejected', upstreamStatus: attempt.upstreamStatus, attempt: attempt.envelopeSha256 }, { status: 502 });
  }
  return Response.json({
    error: attempt?.state === 'ambiguous'
      ? 'A prior publication outcome is ambiguous; automatic retry is blocked.'
      : 'A publication attempt is already reserved; automatic retry is blocked.',
    code,
    state: attempt?.state ?? 'unknown',
    attempt: attempt?.envelopeSha256 ?? null,
  }, { status: 409 });
}

async function markAttempt(
  attempts: RelayAttemptStore,
  envelopeSha256: string,
  state: 'published' | 'rejected' | 'ambiguous',
  upstreamStatus: number | null,
  detail: string,
  completedAt: string,
) {
  return attempts.complete({ envelopeSha256, state, upstreamStatus, upstreamDetail: detail, completedAt });
}

export async function handleTechnocoreRelayPost(
  request: Request,
  configuration: RelayConfiguration,
  dependencies: TechnocoreRelayDependencies,
) {
  if (!configuration.enabled || !configuration.publicOrigin) {
    return Response.json({ error: configuration.reason, code: configuration.code }, { status: 403 });
  }
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return Response.json({ error: 'Relay accepts application/json only.' }, { status: 415 });
  }
  if (request.headers.get('origin') !== configuration.publicOrigin) {
    return Response.json({ error: 'Relay request origin must equal FOUNDRY_PUBLIC_ORIGIN.' }, { status: 403 });
  }

  let message: unknown;
  try {
    message = parseStrictJsonBytes(await boundedRequestBytes(request));
  } catch (cause) {
    return Response.json({ error: 'Expected a bounded strict-JSON signed Technocore announcement.' }, { status: cause instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (!looksLikeMessage(message)) return Response.json({ error: 'Malformed Technocore announcement.' }, { status: 400 });

  let announcement: ReturnType<typeof assertPublicReceiptAnnouncement>;
  try {
    announcement = assertPublicReceiptAnnouncement(message.text, configuration.publicOrigin);
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : 'Malformed Foundry announcement.' }, { status: 400 });
  }
  try {
    if (!(await dependencies.verifyMessage(message))) {
      return Response.json({ error: 'Technocore message signature is invalid.' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Technocore message signature could not be verified.' }, { status: 400 });
  }

  let result: RelayResult | null;
  try {
    result = await dependencies.findPublishableResult(announcement.receiptId);
  } catch {
    return Response.json({ error: 'Local result state is temporarily unavailable.', code: 'local_state_unavailable' }, { status: 503 });
  }
  if (
    !result || result.acceptanceDecision !== 'accepted' ||
    message.did !== result.actorDid || announcement.missionId !== result.missionId ||
    announcement.claimantLabel !== compactDid(result.actorDid) ||
    announcement.artifactSha256 !== `sha256:${result.artifactSha256}` ||
    announcement.issuerState !== 'accepted'
  ) {
    return Response.json({ error: 'Announcement does not bind the latest accepted local result and claimant DID.' }, { status: 400 });
  }
  try {
    const receiptBytes = new TextEncoder().encode(result.receiptJson);
    if (receiptBytes.byteLength > 32 * 1024 || !(await dependencies.verifyResultReceipt(parseStrictJsonBytes(receiptBytes)))) {
      return Response.json({ error: 'The stored result receipt is no longer valid for publication.' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'The stored result receipt is no longer valid for publication.' }, { status: 400 });
  }

  const [envelopeDigest, textDigest] = await Promise.all([
    sha256Hex(canonicalJson(message)),
    sha256Hex(message.text),
  ]);
  const timestamp = () => (dependencies.now ?? (() => new Date()))().toISOString();
  const reservedAt = timestamp();
  let reservation: Awaited<ReturnType<RelayAttemptStore['reserve']>>;
  try {
    reservation = await dependencies.attempts.reserve({
      envelopeSha256: `sha256:${envelopeDigest}`,
      resultId: result.id,
      room: message.room,
      actorDid: message.did,
      nonce: message.nonce,
      textSha256: `sha256:${textDigest}`,
      reservedAt,
    });
  } catch {
    return Response.json({ error: 'Publication could not be durably reserved; no upstream request was made.', code: 'reservation_unavailable' }, { status: 503 });
  }
  if (!reservation.reserved) {
    if (reservation.reason === 'replay') return lockedResponse(reservation.attempt, 'exact_replay');
    if (reservation.reason === 'result_locked') return lockedResponse(reservation.attempt, 'result_locked');
    if (reservation.reason === 'stale_nonce') return Response.json({ error: 'Technocore nonce is not strictly newer for this DID and room.', code: 'stale_nonce' }, { status: 409 });
    return Response.json({ error: 'Publication reservation conflicted; no upstream request was made.', code: 'reservation_conflict' }, { status: 409 });
  }

  let upstream: Response;
  try {
    upstream = await dependencies.upstreamFetch(FOUNDRY_TECHNOCORE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Technocore-Foundry/1.0' },
      body: JSON.stringify({ did: message.did, sig: message.sig, nonce: message.nonce, text: message.text }),
      signal: AbortSignal.timeout(8_000),
      redirect: 'manual',
    });
  } catch {
    try {
      await markAttempt(dependencies.attempts, reservation.attempt.envelopeSha256, 'ambiguous', null, 'Transport ended without a confirmed upstream outcome.', timestamp());
    } catch {
      // The durable reserved row still blocks automatic replay.
    }
    return Response.json({ error: 'Technocore publication outcome is unknown; automatic retry is blocked.', code: 'outcome_ambiguous', attempt: reservation.attempt.envelopeSha256 }, { status: 503 });
  }

  const knownRejection = [400, 403, 422, 429].includes(upstream.status);
  if (!upstream.ok) {
    const state = knownRejection ? 'rejected' : 'ambiguous';
    const detail = knownRejection
      ? 'Technocore returned a known rejection status.'
      : 'Technocore returned a non-success status with an uncertain outcome.';
    await upstream.body?.cancel().catch(() => undefined);
    try {
      await markAttempt(dependencies.attempts, reservation.attempt.envelopeSha256, state, upstream.status, detail, timestamp());
    } catch {
      return Response.json({ error: 'Technocore responded, but the durable outcome record could not be completed. Automatic retry is blocked.', code: 'completion_uncertain', attempt: reservation.attempt.envelopeSha256 }, { status: 503 });
    }
    if (knownRejection) {
      return Response.json({ error: 'Technocore rejected the announcement.', code: 'upstream_rejected', upstreamStatus: upstream.status, detail, attempt: reservation.attempt.envelopeSha256 }, { status: 502 });
    }
    return Response.json({ error: 'Technocore publication outcome is not safely retryable.', code: 'outcome_ambiguous', upstreamStatus: upstream.status, detail, attempt: reservation.attempt.envelopeSha256 }, { status: 503 });
  }

  let acknowledgement: { seq: number };
  try {
    if (upstream.status !== 200 || upstream.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      throw new Error('unexpected upstream success status or content type');
    }
    acknowledgement = assertPublishedAcknowledgement(parseLosslessIntegerJsonBytes(await boundedResponseBytes(upstream)), message);
  } catch {
    try {
      await markAttempt(dependencies.attempts, reservation.attempt.envelopeSha256, 'ambiguous', upstream.status, 'Success response did not contain a bounded acknowledgement for the signed announcement.', timestamp());
    } catch {
      // The durable reserved row still blocks automatic replay.
    }
    return Response.json({ error: 'Technocore success could not be bound to this announcement; automatic retry is blocked.', code: 'outcome_ambiguous', upstreamStatus: upstream.status, attempt: reservation.attempt.envelopeSha256 }, { status: 503 });
  }
  try {
    await markAttempt(dependencies.attempts, reservation.attempt.envelopeSha256, 'published', 200, `seq:${acknowledgement.seq}`, timestamp());
  } catch {
    return Response.json({ error: 'Technocore acknowledged the request, but the durable completion record failed. Automatic retry is blocked.', code: 'completion_uncertain', attempt: reservation.attempt.envelopeSha256 }, { status: 503 });
  }
  return Response.json({
    status: 'published',
    room: FOUNDRY_TECHNOCORE_ROOM,
    upstreamStatus: 200,
    seq: acknowledgement.seq,
    attempt: reservation.attempt.envelopeSha256,
  });
}
