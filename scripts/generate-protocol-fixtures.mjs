import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TECHNOCORE_SOURCE_COMMIT = '9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c';
const TCR1_SOURCE_COMMIT = '37c9a0eddcc56e414fe9c462c14b7f9f424dc596';
const TEST_SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function compareUnicode(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => compareUnicode(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

function base58(bytes) {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let output = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    output = BASE58[remainder] + output;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}

function signature(privateKey, bytes) {
  return sign(null, bytes, privateKey).toString('base64url');
}

function foundryVector(privateKey, event) {
  const canonical = canonicalJson(event);
  const payload = Buffer.concat([Buffer.from('foundry-event-v1\0'), Buffer.from(canonical)]);
  return {
    domain: 'foundry-event-v1',
    canonical_unsigned: canonical,
    signing_payload_hex: payload.toString('hex'),
    envelope: { event, signature: signature(privateKey, payload) },
  };
}

function sha256(value) {
  return crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value)
    .then((digest) => Buffer.from(digest).toString('hex'));
}

function sweepTechnocore(text) {
  const clean = Array.from(text)
    .map((character) => /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u.test(character) ? ' ' : character)
    .join('')
    .trim();
  if (!clean) throw new Error('Technocore fixture text is empty after sweeping.');
  if (Array.from(clean).length > 4096) throw new Error('Technocore fixture text exceeds 4096 characters.');
  return clean;
}

const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, TEST_SEED]), format: 'der', type: 'pkcs8' });
const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
const publicKey = new Uint8Array(publicDer.subarray(-32));
const didBytes = new Uint8Array(34);
didBytes.set([0xed, 0x01]);
didBytes.set(publicKey, 2);
const did = `did:key:z${base58(didBytes)}`;

const requirements = 'Fixture requirement: preserve exact bytes and verify every proof layer independently.';
const artifactBytes = new TextEncoder().encode('Technocore Foundry deterministic fixture.\n');
const requirementsHash = await sha256(requirements);
const artifactHash = await sha256(artifactBytes);
const foundryEvent = {
  schema: 'foundry-event-v1',
  type: 'claim',
  missionId: 'F-F17E2026',
  requirementsHash: `sha256:${requirementsHash}`,
  actor: did,
  nonce: '1787760000000000001',
  createdAt: '2026-08-27T00:00:00.000Z',
};
const foundryCanonical = canonicalJson(foundryEvent);
const foundryPayload = Buffer.concat([Buffer.from('foundry-event-v1\0'), Buffer.from(foundryCanonical)]);
const foundryEnvelope = { event: foundryEvent, signature: signature(privateKey, foundryPayload) };

const tcrUnsigned = {
  type: 'technocore-task-receipt',
  version: 1,
  task: { id: foundryEvent.missionId, issuer: did, requirements_sha256: requirementsHash },
  claimant: { did },
  artifacts: [{ type: 'text/plain', uri: 'https://example.org/artifacts/foundry-fixture.txt', sha256: artifactHash, size: artifactBytes.length }],
  created_at: '2026-08-27T00:00:01.000Z',
  evidence: {
    repository: 'https://github.com/flop-labs/technocore-chat',
    commit: TECHNOCORE_SOURCE_COMMIT,
    acceptance_sha256: 'b'.repeat(64),
  },
};
const tcrCanonical = canonicalJson(tcrUnsigned);
const tcrPayload = Buffer.concat([Buffer.from('technocore-task-receipt:v1\0'), Buffer.from(tcrCanonical)]);
const tcrReceipt = {
  ...tcrUnsigned,
  signature: { algorithm: 'Ed25519', domain: 'technocore-task-receipt:v1', value: signature(privateKey, tcrPayload) },
};
const tcrReceiptHash = await sha256(canonicalJson(tcrReceipt));

const verificationReceipt = {
  schema: 'foundry-verification-receipt-v1',
  resultId: `res_${'4'.repeat(24)}`,
  resultReceiptSha256: `sha256:${tcrReceiptHash}`,
  candidateCommit: TECHNOCORE_SOURCE_COMMIT,
  verifierDid: did,
  checks: [{
    id: 'protocol-fixture',
    executableSha256: `sha256:${await sha256('fixture executable bytes')}`,
    argvSha256: `sha256:${await sha256('["npm","run","test:protocol"]')}`,
    exitCode: 0,
    stdoutSha256: `sha256:${await sha256('fixture stdout')}`,
    stderrSha256: `sha256:${await sha256('')}`,
    durationMs: 4812,
  }],
  createdAt: '2026-08-27T00:00:05.000Z',
};
const verificationCanonical = canonicalJson(verificationReceipt);
const verificationPayload = Buffer.concat([Buffer.from('foundry-verification-receipt-v1\0'), Buffer.from(verificationCanonical)]);
const verificationEnvelope = {
  receipt: verificationReceipt,
  signature: { algorithm: 'Ed25519', domain: 'foundry-verification-receipt-v1', value: signature(privateKey, verificationPayload) },
};
const verificationEnvelopeHash = await sha256(canonicalJson(verificationEnvelope));

const reviewReceipt = {
  schema: 'foundry-review-receipt-v1',
  missionId: foundryEvent.missionId,
  resultId: verificationReceipt.resultId,
  resultReceiptSha256: verificationReceipt.resultReceiptSha256,
  candidateCommit: TECHNOCORE_SOURCE_COMMIT,
  reviewerDid: did,
  criteria: [
    {
      id: 'exact-result-binding',
      status: 'met',
      evidence: 'The review binds the exact deterministic TCR-1 result receipt digest.',
    },
    {
      id: 'local-check-provenance',
      status: 'met',
      evidence: 'The referenced verification receipt binds successful local check digests.',
    },
  ],
  findings: [{
    id: 'protocol-boundary',
    severity: 'info',
    path: 'protocol/fixtures/v1.json',
    summary: 'Fixture conformance verifies portable bytes without asserting issuer acceptance.',
  }],
  reviewDecision: 'approved',
  verificationReceiptSha256: `sha256:${verificationEnvelopeHash}`,
  residualRisks: ['Fixture signatures establish interoperability, not contribution truth.'],
  createdAt: '2026-08-27T00:00:06.000Z',
};
const reviewCanonical = canonicalJson(reviewReceipt);
const reviewPayload = Buffer.concat([Buffer.from('foundry-review-receipt-v1\0'), Buffer.from(reviewCanonical)]);
const reviewEnvelope = {
  receipt: reviewReceipt,
  signature: { algorithm: 'Ed25519', domain: 'foundry-review-receipt-v1', value: signature(privateKey, reviewPayload) },
};

const parentResultId = `res_${'1'.repeat(24)}`;
const parentReceiptHash = tcrReceiptHash;
const changeRequestEvent = {
  schema: 'foundry-event-v1',
  type: 'change_request',
  missionId: foundryEvent.missionId,
  resultId: parentResultId,
  resultSha256: `sha256:${parentReceiptHash}`,
  note: 'Add an independently reproducible revision-chain vector.',
  actor: did,
  nonce: '1787760000000000003',
  createdAt: '2026-08-27T00:00:02.000Z',
};
const changeRequestVector = foundryVector(privateKey, changeRequestEvent);
const changeRequestHash = await sha256(canonicalJson(changeRequestVector.envelope));
const revisionEvent = {
  schema: 'foundry-event-v1',
  type: 'revision',
  missionId: foundryEvent.missionId,
  claimId: `frc_${'2'.repeat(24)}`,
  resultId: `res_${'3'.repeat(24)}`,
  resultSha256: `sha256:${'c'.repeat(64)}`,
  parentResultId,
  parentResultSha256: `sha256:${parentReceiptHash}`,
  changeRequestId: `fcr_${changeRequestHash.slice(0, 24)}`,
  changeRequestSha256: `sha256:${changeRequestHash}`,
  revision: 2,
  actor: did,
  nonce: '1787760000000000004',
  createdAt: '2026-08-27T00:00:03.000Z',
};
const revisionVector = foundryVector(privateKey, revisionEvent);
const attestationEvent = {
  schema: 'foundry-event-v1',
  type: 'attestation',
  missionId: foundryEvent.missionId,
  resultId: revisionEvent.resultId,
  resultSha256: revisionEvent.resultSha256,
  statement: 'reproduced',
  note: 'Fixture peer independently reproduced the immutable artifact digest.',
  actor: did,
  nonce: '1787760000000000005',
  createdAt: '2026-08-27T00:00:04.000Z',
};
const attestationVector = foundryVector(privateKey, attestationEvent);

const rawMessage = 'Cafe\u0301\nNFC stays distinct from Café\u200d.';
const sweptMessage = sweepTechnocore(rawMessage);
const technocoreMessage = {
  room: 'foundry-contributions',
  did,
  nonce: '1787760000000000002',
  text: sweptMessage,
};
const technocorePayload = Buffer.from(`${technocoreMessage.room}|${technocoreMessage.nonce}|${technocoreMessage.text}`);
const technocoreEnvelope = { ...technocoreMessage, sig: signature(privateKey, technocorePayload) };

const canonicalInput = {
  2: 'two',
  10: 'ten',
  z: 0,
  'é': 'composed',
  'é': 'decomposed',
  '😀': 'astral',
  '\ue000': 'private-use-key',
  nested: [null, true, false, 42, 'Türkçe'],
};

const fixture = {
  schema: 'technocore-foundry-protocol-fixtures-v1',
  generated_at: '2026-08-27T00:00:00.000Z',
  sources: {
    technocore_chat_commit: TECHNOCORE_SOURCE_COMMIT,
    tcr1_receipts_commit: TCR1_SOURCE_COMMIT,
  },
  key: {
    algorithm: 'Ed25519',
    public_key_hex: Buffer.from(publicKey).toString('hex'),
    did,
    note: 'RFC 8032 public test key; never use fixture keys for real identities.',
  },
  vectors: {
    foundry_event: {
      domain: 'foundry-event-v1',
      canonical_unsigned: foundryCanonical,
      signing_payload_hex: foundryPayload.toString('hex'),
      envelope: foundryEnvelope,
    },
    change_request_event: changeRequestVector,
    revision_event: revisionVector,
    attestation_event: attestationVector,
    tcr1_receipt: {
      domain: 'technocore-task-receipt:v1',
      canonical_unsigned: tcrCanonical,
      signing_payload_hex: tcrPayload.toString('hex'),
      receipt: tcrReceipt,
    },
    verification_receipt: {
      domain: 'foundry-verification-receipt-v1',
      canonical_unsigned: verificationCanonical,
      signing_payload_hex: verificationPayload.toString('hex'),
      envelope: verificationEnvelope,
    },
    review_receipt: {
      domain: 'foundry-review-receipt-v1',
      canonical_unsigned: reviewCanonical,
      signing_payload_hex: reviewPayload.toString('hex'),
      envelope: reviewEnvelope,
    },
    technocore_message: {
      domain: '<room>|<nonce>|<text>',
      raw_text_before_sweep: rawMessage,
      swept_text: sweptMessage,
      signing_payload_hex: technocorePayload.toString('hex'),
      message: technocoreEnvelope,
    },
  },
  canonical_json: {
    input: canonicalInput,
    output: canonicalJson(canonicalInput),
  },
  invalid_json: [
    { name: 'duplicate-key', source: '{"key":1,"key":2}', expected: 'reject' },
    { name: 'floating-point', source: '{"value":1.5}', expected: 'reject' },
    { name: 'unsafe-integer', source: '{"value":9007199254740992}', expected: 'reject' },
    { name: 'lone-surrogate', source: '{"value":"\\ud800"}', expected: 'reject' },
    { name: 'non-json-constant', source: '{"value":NaN}', expected: 'reject' },
  ],
  invalid_utf8: [
    { name: 'invalid-byte-in-string', hex: '7b2276616c7565223a22ff227d', expected: 'reject' },
  ],
  technocore_sweep: [
    { name: 'line-and-format-to-space', input: rawMessage, output: sweptMessage },
    { name: 'nfc-and-nfd-remain-distinct', input: 'Café|Café', output: 'Café|Café' },
    { name: 'line-separators-to-space', input: 'a\u2028b\u2029c', output: 'a b c' },
    { name: 'outer-protocol-space-is-trimmed', input: '\n  retained  \u200d', output: 'retained' },
  ],
};

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureDirectory = `${projectRoot}/protocol/fixtures`;
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(`${fixtureDirectory}/v1.json`, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ fixture: 'protocol/fixtures/v1.json', did, vectors: 8, invalid: fixture.invalid_json.length + fixture.invalid_utf8.length }));
