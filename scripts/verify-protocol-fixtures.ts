import { readFile } from 'node:fs/promises';
import {
  canonicalJson,
  eventSigningBytes,
  publicKeyFromDid,
  sweepTechnocoreText,
  type SignedFoundryEvent,
  type Tcr1Receipt,
  type TechnocoreSignedMessage,
  verifySignedEvent,
  verifyTcr1Receipt,
  verifyTechnocoreMessage,
} from '../lib/foundry-crypto';
import { decodeStrictUtf8, parseStrictJson } from '../lib/strict-json';

type Fixture = {
  schema: string;
  key: { public_key_hex: string; did: string };
  vectors: {
    foundry_event: { canonical_unsigned: string; signing_payload_hex: string; envelope: SignedFoundryEvent };
    change_request_event: { canonical_unsigned: string; signing_payload_hex: string; envelope: SignedFoundryEvent };
    revision_event: { canonical_unsigned: string; signing_payload_hex: string; envelope: SignedFoundryEvent };
    attestation_event: { canonical_unsigned: string; signing_payload_hex: string; envelope: SignedFoundryEvent };
    tcr1_receipt: { canonical_unsigned: string; signing_payload_hex: string; receipt: Tcr1Receipt };
    technocore_message: { signing_payload_hex: string; message: TechnocoreSignedMessage };
  };
  canonical_json: { input: unknown; output: string };
  invalid_json: Array<{ name: string; source: string }>;
  invalid_utf8: Array<{ name: string; hex: string }>;
  technocore_sweep: Array<{ name: string; input: string; output: string }>;
};

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const raw = await readFile(new URL('../protocol/fixtures/v1.json', import.meta.url), 'utf8');
const fixture = parseStrictJson(raw) as Fixture;
if (fixture.schema !== 'technocore-foundry-protocol-fixtures-v1') throw new Error('Unexpected fixture schema.');
if (hex(publicKeyFromDid(fixture.key.did)) !== fixture.key.public_key_hex) throw new Error('DID/public-key vector mismatch.');

for (const [name, event] of [
  ['claim', fixture.vectors.foundry_event],
  ['change-request', fixture.vectors.change_request_event],
  ['revision', fixture.vectors.revision_event],
  ['attestation', fixture.vectors.attestation_event],
] as const) {
  if (canonicalJson(event.envelope.event) !== event.canonical_unsigned) throw new Error(`${name} canonical JSON mismatch.`);
  if (hex(eventSigningBytes(event.envelope.event)) !== event.signing_payload_hex) throw new Error(`${name} signing bytes mismatch.`);
  if (!(await verifySignedEvent(event.envelope))) throw new Error(`${name} event signature is invalid.`);
}

const tcr = fixture.vectors.tcr1_receipt;
const unsignedTcr = { ...tcr.receipt } as Partial<Tcr1Receipt>;
Reflect.deleteProperty(unsignedTcr, 'signature');
if (canonicalJson(unsignedTcr) !== tcr.canonical_unsigned) throw new Error('TCR-1 canonical JSON mismatch.');
const tcrBytes = new TextEncoder().encode(`technocore-task-receipt:v1\0${tcr.canonical_unsigned}`);
if (hex(tcrBytes) !== tcr.signing_payload_hex) throw new Error('TCR-1 signing bytes mismatch.');
if (!(await verifyTcr1Receipt(tcr.receipt))) throw new Error('TCR-1 signature is invalid.');

const technocore = fixture.vectors.technocore_message;
const messageBytes = new TextEncoder().encode(`${technocore.message.room}|${technocore.message.nonce}|${technocore.message.text}`);
if (hex(messageBytes) !== technocore.signing_payload_hex) throw new Error('Technocore signing bytes mismatch.');
if (!(await verifyTechnocoreMessage(technocore.message))) throw new Error('Technocore signature is invalid.');

if (canonicalJson(fixture.canonical_json.input) !== fixture.canonical_json.output) throw new Error('Canonical JSON ordering vector mismatch.');
for (const vector of fixture.invalid_json) {
  let rejected = false;
  try {
    parseStrictJson(vector.source);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Invalid JSON vector was accepted: ${vector.name}.`);
}
for (const vector of fixture.invalid_utf8) {
  let rejected = false;
  try {
    decodeStrictUtf8(Uint8Array.from(vector.hex.match(/../g) ?? [], (part) => Number.parseInt(part, 16)));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Invalid UTF-8 vector was accepted: ${vector.name}.`);
}
for (const vector of fixture.technocore_sweep) {
  if (sweepTechnocoreText(vector.input) !== vector.output) throw new Error(`Technocore sweep mismatch: ${vector.name}.`);
}

console.log(JSON.stringify({
  runtime: 'typescript',
  did: 'valid',
  foundryEvent: 'valid',
  changeRequest: 'valid',
  revisionChain: 'valid',
  peerAttestation: 'valid',
  tcr1: 'valid',
  technocore: 'valid',
  canonical: 'match',
  invalidRejected: fixture.invalid_json.length + fixture.invalid_utf8.length,
  sweepVectors: fixture.technocore_sweep.length,
}));
