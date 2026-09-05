import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectObservedTag } from './lib/technocore-watch-policy.mjs';
import {
  createVault,
  isCanonicalTechnocoreSignature,
  nextTechnocoreNonce,
  signTechnocoreMessage,
  signTechnocoreNote,
  sweepTechnocoreText,
  verifyTechnocoreMessage,
  verifyTechnocoreNote,
} from '../lib/foundry-crypto';
import {
  assertTechnocoreRoomName,
  ownedTechnocoreRoom,
  TECHNOCORE_ADAPTER_VERSION,
  TECHNOCORE_IDLE_SECONDS,
  TECHNOCORE_OPERATIONAL_COMMIT,
  TECHNOCORE_RELEASE_TAG,
  TECHNOCORE_STILLBORN_SECONDS,
} from '../lib/technocore-contract';
import {
  parseTechnocoreAcknowledgement,
  technocoreProfileLocation,
  verifyTechnocoreExport,
  verifyTechnocoreRecordProof,
  type TechnocoreRecordProof,
} from '../lib/technocore-records';
import {
  handleTechnocoreReadinessGet,
  handleTechnocoreReadinessPost,
  type LiveTechnocoreStatus,
} from '../lib/technocore-readiness-service';

const encoder = new TextEncoder();
const passphrase = 'test-only-passphrase-for-technocore';
const room = 'd-foundry-contract';
const timestamp = '2026-09-02T20:00:00.000Z';
const localOrigin = 'http://localhost:3000';
const confirmation = 'publish_to_technocore';

function signedRecordLine(seq: string, message: Awaited<ReturnType<typeof signTechnocoreMessage>>, text = message.text) {
  return `{"seq":${seq},"ts":${JSON.stringify(timestamp)},"from":${JSON.stringify(message.did)},"text":${JSON.stringify(text)},"nonce":${message.nonce},"sig":${JSON.stringify(message.sig)}}`;
}

function readinessRequest(body: unknown, origin = localOrigin) {
  return new Request(`${localOrigin}/api/technocore/readiness`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

assert.equal(TECHNOCORE_RELEASE_TAG, `v${TECHNOCORE_ADAPTER_VERSION}`);
assert.match(TECHNOCORE_OPERATIONAL_COMMIT, /^[a-f0-9]{40}$/);
assert.equal(TECHNOCORE_IDLE_SECONDS, 7 * 24 * 60 * 60);
assert.equal(TECHNOCORE_STILLBORN_SECONDS, 12 * 60 * 60);
assert.equal(assertTechnocoreRoomName(room), room);
assert.equal(ownedTechnocoreRoom('foundry-contract'), room);
assert.equal(ownedTechnocoreRoom(room), room);
assert.throws(() => assertTechnocoreRoomName('Bad Room'), /Room names/);
assert.throws(() => ownedTechnocoreRoom(''), /non-empty|Room names/);
assert.equal(sweepTechnocoreText('\n \u200d useful\u2028message \t'), 'useful message');
assert.throws(() => sweepTechnocoreText('\n\u200d\t'), /visible character/);
assert.throws(() => sweepTechnocoreText('🚀'.repeat(4097)), /4096-character/);
assert.throws(() => nextTechnocoreNonce('01'), /canonical/);

const vault = await createVault(passphrase);
const message = await signTechnocoreMessage(
  vault,
  passphrase,
  room,
  'Technocore export proof with a lossless nineteen-digit nonce.',
  '9223372036854775806',
);
assert.equal(message.nonce, '9223372036854775807');
assert.equal(isCanonicalTechnocoreSignature(message.sig), true);
assert.equal(isCanonicalTechnocoreSignature(`${message.sig.slice(0, -1)}B`), false);
assert.equal(await verifyTechnocoreMessage(message), true);
assert.equal(await verifyTechnocoreMessage({ ...message, room: 'd-other-room' }), false);
assert.equal(await verifyTechnocoreMessage({ ...message, text: `${message.text} tampered` }), false);
assert.equal(await verifyTechnocoreMessage({ ...message, nonce: `0${message.nonce}` }), false);

const ownerNote = await signTechnocoreNote(vault, passphrase, 'room-owners', room, vault.did, message.nonce);
assert.equal(await verifyTechnocoreNote(ownerNote), true);
assert.equal(await verifyTechnocoreNote({ ...ownerNote, key: 'd-other-room' }), false);
assert.equal(await verifyTechnocoreNote({ ...ownerNote, value: `${vault.did}x` }), false);

const validLine = signedRecordLine('9007199254740993', message);
const legacyLine = `{"seq":9007199254740994,"ts":${JSON.stringify(timestamp)},"from":${JSON.stringify(message.did)},"text":"legacy retained DID record","nonce":9223372036854775808}`;
const unsignedLine = `{"seq":9007199254740995,"ts":${JSON.stringify(timestamp)},"from":"agent-alias","text":"unsigned historical record"}`;
const exportBytes = encoder.encode(`${validLine}\n${legacyLine}\n${unsignedLine}\n`);
const report = await verifyTechnocoreExport(exportBytes, room);
assert.equal(report.records.length, 3);
assert.deepEqual(report.counts, { valid: 1, invalid: 0, not_reverifiable: 1, unsigned: 1 });
assert.equal(report.records[0].seq, '9007199254740993');
assert.equal(report.records[0].nonce, message.nonce);
assert.equal(report.sequenceMetadata, 'server_asserted_unsigned');
assert.equal(report.timestampMetadata, 'server_asserted_unsigned');
assert.equal(report.generationMetadata, 'external_header_unsigned');

const wrongRoom = await verifyTechnocoreExport(encoder.encode(`${validLine}\n`), 'd-other-room');
assert.equal(wrongRoom.records[0].signatureState, 'invalid');
const selfAssertedDid = await verifyTechnocoreExport(encoder.encode(
  `{"seq":1,"ts":${JSON.stringify(timestamp)},"from":${JSON.stringify(message.did)},"text":"unsigned did-looking nickname"}\n`,
), room);
assert.equal(selfAssertedDid.records[0].signatureState, 'unsigned');
const tampered = await verifyTechnocoreExport(encoder.encode(`${signedRecordLine('1', message, `${message.text} tampered`)}\n`), room);
assert.equal(tampered.records[0].signatureState, 'invalid');
await assert.rejects(verifyTechnocoreExport(encoder.encode(validLine), room), /final newline/);
await assert.rejects(verifyTechnocoreExport(encoder.encode(`${validLine}\n\n`), room), /empty line/);
await assert.rejects(verifyTechnocoreExport(encoder.encode(`\uFEFF${validLine}\n`), room), /BOM/);
await assert.rejects(
  verifyTechnocoreExport(encoder.encode(`${unsignedLine}\n${validLine}\n`), room),
  /ascending sequence order/,
);
await assert.rejects(
  verifyTechnocoreExport(encoder.encode(`{"seq":1,"seq":2,"ts":${JSON.stringify(timestamp)},"from":"alias","text":"duplicate"}\n`), room),
  /Duplicate object key/,
);

const acknowledgementBytes = encoder.encode(
  `{"room":${JSON.stringify(room)},"generation":3,"posted":${validLine}}`,
);
const proof = await parseTechnocoreAcknowledgement(acknowledgementBytes, message, timestamp);
assert.equal(proof.record.seq, '9007199254740993');
assert.equal(proof.record.nonce, message.nonce);
assert.equal(proof.generation, 3);
assert.equal(await verifyTechnocoreRecordProof(proof), true);
assert.equal(await verifyTechnocoreRecordProof({ ...proof, generation: -1 }), false);
assert.equal(await verifyTechnocoreRecordProof({ ...proof, record: { ...proof.record, text: 'tampered' } }), false);
assert.equal(await verifyTechnocoreRecordProof({ ...proof, verification: { ...proof.verification, serverInclusionProof: 'established' } }), false);
assert.equal(await verifyTechnocoreRecordProof({ ...proof, extra: true }), false);

const profile = await technocoreProfileLocation(vault.did);
assert.match(profile.fingerprint, /^[a-f0-9]{16}$/);
assert.equal(profile.namespace, `did-${profile.fingerprint.slice(0, 2)}`);
assert.equal(profile.key, profile.fingerprint.slice(2));

const compatible: LiveTechnocoreStatus = {
  state: 'compatible',
  supportedVersion: TECHNOCORE_ADAPTER_VERSION,
  liveVersion: TECHNOCORE_ADAPTER_VERSION,
  supportedCommit: TECHNOCORE_OPERATIONAL_COMMIT,
  openapiSha256: 'a'.repeat(64),
  configSha256: 'b'.repeat(64),
  agentSha256: 'c'.repeat(64),
  openapiMatch: true,
  configMatch: true,
  agentMatch: true,
  writesEnabled: true,
  reason: 'test adapter match',
};

let publishFetches = 0;
const publishFetcher: typeof fetch = async (url, init) => {
  publishFetches += 1;
  assert.equal(String(url), `https://technocore.chat/r/${room}?format=json`);
  assert.equal(init?.redirect, 'manual');
  assert.deepEqual(JSON.parse(String(init?.body)), {
    did: message.did, sig: message.sig, nonce: message.nonce, text: message.text,
  });
  return new Response(acknowledgementBytes, { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const published = await handleTechnocoreReadinessPost(readinessRequest({
  action: 'publish_message', confirmation, message,
}), { upstreamFetch: publishFetcher, compatibility: async () => compatible, now: () => new Date(timestamp) });
assert.equal(published.status, 200);
const publishedBody = await published.json() as { status: string; proof: TechnocoreRecordProof };
assert.equal(publishedBody.status, 'published');
assert.equal(await verifyTechnocoreRecordProof(publishedBody.proof), true);
assert.equal(publishFetches, 1);

let blockedFetches = 0;
const blocked = await handleTechnocoreReadinessPost(readinessRequest({ action: 'publish_message', confirmation, message }), {
  upstreamFetch: async () => { blockedFetches += 1; throw new Error('must not fetch'); },
  compatibility: async () => ({ ...compatible, state: 'incompatible', writesEnabled: false, reason: 'drifted' }),
});
assert.equal(blocked.status, 502);
assert.equal(blockedFetches, 0);
assert.equal((await handleTechnocoreReadinessPost(
  readinessRequest({ action: 'publish_message', confirmation, message }, 'https://evil.example'),
  { upstreamFetch: publishFetcher, compatibility: async () => compatible },
)).status, 403);
assert.equal((await handleTechnocoreReadinessPost(
  readinessRequest({ action: 'publish_message', message }),
  { upstreamFetch: publishFetcher, compatibility: async () => compatible },
)).status, 400);

let profileBody: Record<string, unknown> | undefined;
const profileWrite = await handleTechnocoreReadinessPost(readinessRequest({
  action: 'publish_profile', confirmation, did: vault.did, value: '  useful routing hint  ', previousValue: null,
}), {
  compatibility: async () => compatible,
  upstreamFetch: async (url, init) => {
    assert.equal(String(url), `https://technocore.chat/kv/${profile.namespace}/${profile.key}?format=json`);
    profileBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('{"ok":true}\n', { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
assert.equal(profileWrite.status, 200);
assert.deepEqual(profileBody, { value: 'useful routing hint', if_absent: true });

let noteBody: Record<string, unknown> | undefined;
const claim = await handleTechnocoreReadinessPost(readinessRequest({
  action: 'publish_signed_note', confirmation, operation: 'claim', note: ownerNote,
}), {
  compatibility: async () => compatible,
  upstreamFetch: async (url, init) => {
    assert.equal(String(url), `https://technocore.chat/kv/room-owners/${room}?format=json`);
    noteBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('{"ok":true}\n', { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
assert.equal(claim.status, 200);
assert.deepEqual(noteBody, {
  did: ownerNote.did, sig: ownerNote.sig, nonce: ownerNote.nonce, value: ownerNote.value, if_absent: true,
});

const proxiedExport = await handleTechnocoreReadinessGet(
  new Request(`${localOrigin}/api/technocore/readiness?kind=export&room=${room}`),
  { upstreamFetch: async () => new Response(exportBytes, { status: 200, headers: { 'Content-Type': 'application/x-ndjson', 'X-Room-Generation': '3' } }) },
);
assert.equal(proxiedExport.status, 200);
assert.equal(proxiedExport.headers.get('x-room-generation'), '3');
assert.deepEqual(new Uint8Array(await proxiedExport.arrayBuffer()), exportBytes);
const nonceRead = await handleTechnocoreReadinessGet(
  new Request(`${localOrigin}/api/technocore/readiness?kind=message_nonce&room=${room}&did=${encodeURIComponent(vault.did)}`),
  { upstreamFetch: async () => new Response(exportBytes, { status: 200, headers: { 'Content-Type': 'application/x-ndjson', 'X-Room-Generation': '3' } }) },
);
assert.equal(nonceRead.status, 200);
assert.deepEqual(await nonceRead.json(), { room, did: vault.did, generation: 3, nonce: '9223372036854775808' });
const absentNonce = await handleTechnocoreReadinessGet(
  new Request(`${localOrigin}/api/technocore/readiness?kind=message_nonce&room=d-new-room&did=${encodeURIComponent(vault.did)}`),
  { upstreamFetch: async () => new Response('missing', { status: 404, headers: { 'Content-Type': 'text/plain' } }) },
);
assert.deepEqual(await absentNonce.json(), { room: 'd-new-room', did: vault.did, generation: null, nonce: null });
assert.equal((await handleTechnocoreReadinessGet(
  new Request(`http://localhost.evil/api/technocore/readiness?kind=export&room=${room}`),
  { upstreamFetch: async () => { throw new Error('must not fetch'); } },
)).status, 403);

let statusReads = 0;
const status = await handleTechnocoreReadinessGet(new Request(`${localOrigin}/api/technocore/readiness?kind=status`), {
  upstreamFetch: async (url) => {
    statusReads += 1;
    const body = String(url).endsWith('/config') ? JSON.stringify({ version: TECHNOCORE_ADAPTER_VERSION }) : '{}\n';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
const statusBody = await status.json() as LiveTechnocoreStatus;
assert.equal(statusBody.state, 'incompatible');
assert.equal(statusBody.writesEnabled, false);
assert.equal(statusReads, 3);

// Replay exact reviewed live documents, then alter one document at a time.
const snapshots = Object.fromEntries(['config', 'openapi', 'agent'].map((name) => [
  name, readFileSync(new URL(`../protocol/upstream/technocore-live/${name}.json`, import.meta.url), 'utf8'),
]));
assert.equal(JSON.parse(snapshots.config).settings.stillborn_seconds, TECHNOCORE_STILLBORN_SECONDS);
for (const changed of [null, 'config', 'openapi', 'agent']) {
  const response = await handleTechnocoreReadinessGet(new Request(`${localOrigin}/api/technocore/readiness?kind=status`), {
    upstreamFetch: async (url) => {
      const name = String(url).endsWith('/config') ? 'config' : String(url).endsWith('/openapi.json') ? 'openapi' : 'agent';
      return new Response(snapshots[name] + (changed === name ? ' ' : ''), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await response.json() as LiveTechnocoreStatus;
  assert.equal(result.state, changed ? 'incompatible' : 'compatible');
  assert.equal(result.writesEnabled, changed === null);
}
assert.equal(selectObservedTag('v0.11.4', '0.12.0'), 'v0.12.0');
assert.equal(selectObservedTag('v0.12.0', '0.11.4'), 'v0.12.0');
assert.equal(selectObservedTag('v0.9.0', '0.10.0'), 'v0.10.0');
assert.equal(selectObservedTag('v0.12.0', null), 'v0.12.0');
assert.equal(selectObservedTag('v0.12.0', '0.12.0'), 'v0.12.0');
for (const bad of ['../../main', '0.12.0-rc1', '00.12.0', '0.12.0\n']) {
  assert.throws(() => selectObservedTag('v0.11.4', bad));
}

console.log(JSON.stringify({
  technocoreContract: 'ok',
  gates: [
    'single-upstream-lock',
    'canonical-room-and-nonce',
    'message-and-note-signatures',
    'lossless-jsonl-export',
    'legacy-not-reverifiable',
    'unsigned-server-metadata-boundary',
    'acknowledgement-proof',
    'profile-location',
    'loopback-origin-and-explicit-confirmation',
    'live-drift-fail-closed',
    'readiness-write-adapter',
    'retained-room-nonce-floor',
    'bounded-export-proxy',
  ],
}));
