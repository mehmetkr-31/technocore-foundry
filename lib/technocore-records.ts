import {
  didFromPublicKey,
  publicKeyFromDid,
  sha256Hex,
  sweepTechnocoreText,
  verifyTechnocoreMessage,
  type TechnocoreSignedMessage,
} from './foundry-crypto';
import {
  assertTechnocoreRoomName,
  TECHNOCORE_NONCE_PATTERN,
  TECHNOCORE_OPERATIONAL_COMMIT,
  TECHNOCORE_ORIGIN,
  TECHNOCORE_SIGNATURE_PATTERN,
} from './technocore-contract';
import { decodeStrictUtf8, parseLosslessIntegerJsonBytes } from './strict-json';

export const TECHNOCORE_EXPORT_MAX_BYTES = 16 * 1024 * 1024;
export const TECHNOCORE_EXPORT_MAX_LINE_BYTES = 128 * 1024;
export const TECHNOCORE_EXPORT_MAX_RECORDS = 100_000;

export type TechnocoreSignatureState = 'valid' | 'invalid' | 'not_reverifiable' | 'unsigned';

export type TechnocoreRecordVerification = {
  line: number;
  seq: string;
  ts: string;
  from: string;
  nonce: string | null;
  sig: string | null;
  text: string;
  textSha256: string;
  lineSha256: string;
  signatureState: TechnocoreSignatureState;
  reason: string;
};

export type TechnocoreExportVerification = {
  schema: 'foundry-technocore-export-report-v1';
  room: string;
  source: typeof TECHNOCORE_ORIGIN;
  adapterCommit: string;
  bytes: number;
  sha256: string;
  records: TechnocoreRecordVerification[];
  counts: Record<TechnocoreSignatureState, number>;
  sequenceMetadata: 'server_asserted_unsigned';
  timestampMetadata: 'server_asserted_unsigned';
  generationMetadata: 'external_header_unsigned';
};

export type TechnocoreRecordProof = {
  schema: 'foundry-technocore-record-proof-v1';
  source: typeof TECHNOCORE_ORIGIN;
  adapterCommit: string;
  room: string;
  generation: number;
  capturedAt: string;
  record: {
    seq: string;
    ts: string;
    from: string;
    text: string;
    nonce: string;
    sig: string;
  };
  verification: {
    authorSignature: 'valid';
    signedFields: ['room', 'nonce', 'text'];
    serverFields: ['seq', 'ts', 'generation'];
    serverInclusionProof: 'not_cryptographically_established';
  };
};

function exactBytes(bytes: ArrayBuffer | Uint8Array) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function integerString(value: unknown, label: string, options: { positive?: boolean } = {}) {
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error(`${label} must be a JSON integer.`);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${label} was rounded by its JSON parser.`);
  const integer = BigInt(value);
  if (integer < (options.positive ? 1n : 0n)) throw new Error(`${label} is outside the supported range.`);
  return integer.toString();
}

function canonicalDid(value: unknown) {
  if (typeof value !== 'string') throw new Error('Record from must be a string.');
  const publicKey = publicKeyFromDid(value);
  if (didFromPublicKey(publicKey) !== value) throw new Error('Record DID is not canonical.');
  return value;
}

function allowedKeys(value: Record<string, unknown>) {
  const allowed = new Set(['seq', 'ts', 'from', 'text', 'nonce', 'sig']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Record contains an unsupported field.');
}

async function verifyRecord(value: unknown, room: string, line: number, lineBytes: Uint8Array): Promise<TechnocoreRecordVerification> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Line ${line} is not a record object.`);
  const record = value as Record<string, unknown>;
  allowedKeys(record);
  const seq = integerString(record.seq, `Line ${line} seq`, { positive: true });
  if (typeof record.ts !== 'string' || record.ts.length > 64 || !Number.isFinite(Date.parse(record.ts))) throw new Error(`Line ${line} has an invalid server timestamp.`);
  if (typeof record.from !== 'string' || record.from.length < 1 || record.from.length > 160) throw new Error(`Line ${line} has an invalid from value.`);
  if (typeof record.text !== 'string') throw new Error(`Line ${line} has a non-string text value.`);

  let signatureState: TechnocoreSignatureState;
  let reason: string;
  let nonce: string | null = null;
  let signature: string | null = null;
  const carriesNonce = Object.hasOwn(record, 'nonce');
  const carriesSignature = Object.hasOwn(record, 'sig');
  if (!carriesNonce && !carriesSignature) {
    signatureState = 'unsigned';
    reason = 'The record has no DID transport signature.';
  } else {
    let did: string;
    try {
      did = canonicalDid(record.from);
      nonce = integerString(record.nonce, `Line ${line} nonce`);
      if (!TECHNOCORE_NONCE_PATTERN.test(nonce)) throw new Error('Nonce is not a canonical 1-19 digit value.');
      sweepTechnocoreText(record.text);
    } catch (cause) {
      signatureState = 'invalid';
      reason = cause instanceof Error ? cause.message : 'Signed record fields are malformed.';
      return {
        line, seq, ts: record.ts, from: record.from, nonce, sig: null, text: record.text,
        textSha256: `sha256:${await sha256Hex(record.text)}`,
        lineSha256: `sha256:${await sha256Hex(lineBytes)}`,
        signatureState, reason,
      };
    }
    if (!Object.hasOwn(record, 'sig')) {
      signatureState = 'not_reverifiable';
      reason = 'Legacy signed record has no retained signature.';
    } else if (typeof record.sig !== 'string' || !TECHNOCORE_SIGNATURE_PATTERN.test(record.sig)) {
      signatureState = 'invalid';
      reason = 'Signature encoding is malformed or noncanonical.';
    } else {
      signature = record.sig;
      const valid = await verifyTechnocoreMessage({ room, did, sig: signature, nonce, text: record.text });
      signatureState = valid ? 'valid' : 'invalid';
      reason = valid ? 'DID signature binds room, nonce, and text.' : 'DID signature does not bind this room, nonce, and text.';
    }
  }
  return {
    line, seq, ts: record.ts, from: record.from, nonce, sig: signature, text: record.text,
    textSha256: `sha256:${await sha256Hex(record.text)}`,
    lineSha256: `sha256:${await sha256Hex(lineBytes)}`,
    signatureState, reason,
  };
}

export async function verifyTechnocoreExport(bytesInput: ArrayBuffer | Uint8Array, roomInput: string): Promise<TechnocoreExportVerification> {
  const room = assertTechnocoreRoomName(roomInput);
  const bytes = exactBytes(bytesInput);
  if (bytes.byteLength > TECHNOCORE_EXPORT_MAX_BYTES) throw new Error('Technocore export exceeds the 16 MiB local verification limit.');
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('Technocore export must not contain a UTF-8 BOM.');
  }
  const source = decodeStrictUtf8(bytes);
  if (source && !source.endsWith('\n')) throw new Error('Technocore export has no final newline and may be truncated.');
  const rawLines = source.split('\n');
  if (rawLines.at(-1) === '') rawLines.pop();
  if (rawLines.length > TECHNOCORE_EXPORT_MAX_RECORDS) throw new Error('Technocore export contains too many records.');
  if (rawLines.some((line) => line.length === 0)) throw new Error('Technocore export contains an empty line.');

  const encoder = new TextEncoder();
  const records: TechnocoreRecordVerification[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const lineBytes = encoder.encode(rawLines[index]);
    if (lineBytes.byteLength > TECHNOCORE_EXPORT_MAX_LINE_BYTES) throw new Error(`Line ${index + 1} exceeds the verification limit.`);
    const value = parseLosslessIntegerJsonBytes(lineBytes);
    const verified = await verifyRecord(value, room, index + 1, lineBytes);
    if (records.length && BigInt(verified.seq) <= BigInt(records.at(-1)!.seq)) throw new Error(`Line ${index + 1} is not in ascending sequence order.`);
    records.push(verified);
  }
  const counts: Record<TechnocoreSignatureState, number> = { valid: 0, invalid: 0, not_reverifiable: 0, unsigned: 0 };
  records.forEach((record) => { counts[record.signatureState] += 1; });
  return {
    schema: 'foundry-technocore-export-report-v1',
    room,
    source: TECHNOCORE_ORIGIN,
    adapterCommit: TECHNOCORE_OPERATIONAL_COMMIT,
    bytes: bytes.byteLength,
    sha256: `sha256:${await sha256Hex(bytes)}`,
    records,
    counts,
    sequenceMetadata: 'server_asserted_unsigned',
    timestampMetadata: 'server_asserted_unsigned',
    generationMetadata: 'external_header_unsigned',
  };
}

export async function parseTechnocoreAcknowledgement(
  bytesInput: ArrayBuffer | Uint8Array,
  expected: TechnocoreSignedMessage,
  capturedAt = new Date().toISOString(),
): Promise<TechnocoreRecordProof> {
  const value = parseLosslessIntegerJsonBytes(exactBytes(bytesInput));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Technocore acknowledgement must be an object.');
  const response = value as Record<string, unknown>;
  if (response.room !== expected.room || !Number.isSafeInteger(response.generation) || Number(response.generation) < 0) {
    throw new Error('Technocore acknowledgement has an unexpected room or generation.');
  }
  const posted = response.posted;
  if (!posted || typeof posted !== 'object' || Array.isArray(posted)) throw new Error('Technocore acknowledgement has no posted record.');
  const record = posted as Record<string, unknown>;
  allowedKeys(record);
  const seq = integerString(record.seq, 'posted.seq', { positive: true });
  const nonce = integerString(record.nonce, 'posted.nonce');
  if (
    typeof record.ts !== 'string' || record.ts.length > 64 || !Number.isFinite(Date.parse(record.ts)) ||
    record.from !== expected.did || record.text !== expected.text || nonce !== expected.nonce || record.sig !== expected.sig ||
    !(await verifyTechnocoreMessage(expected))
  ) throw new Error('Technocore acknowledgement does not bind the expected signed record.');
  return {
    schema: 'foundry-technocore-record-proof-v1',
    source: TECHNOCORE_ORIGIN,
    adapterCommit: TECHNOCORE_OPERATIONAL_COMMIT,
    room: expected.room,
    generation: Number(response.generation),
    capturedAt,
    record: { seq, ts: record.ts, from: expected.did, text: expected.text, nonce, sig: expected.sig },
    verification: {
      authorSignature: 'valid',
      signedFields: ['room', 'nonce', 'text'],
      serverFields: ['seq', 'ts', 'generation'],
      serverInclusionProof: 'not_cryptographically_established',
    },
  };
}

export async function technocoreProfileLocation(did: string) {
  canonicalDid(did);
  const fingerprint = (await sha256Hex(did)).slice(0, 16);
  return { fingerprint, namespace: `did-${fingerprint.slice(0, 2)}`, key: fingerprint.slice(2) };
}

export async function verifyTechnocoreRecordProof(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proof = value as Partial<TechnocoreRecordProof>;
  if (
    Object.keys(value).length !== 8 ||
    !['schema', 'source', 'adapterCommit', 'room', 'generation', 'capturedAt', 'record', 'verification'].every((key) => Object.hasOwn(value, key)) ||
    proof.schema !== 'foundry-technocore-record-proof-v1' || proof.source !== TECHNOCORE_ORIGIN ||
    typeof proof.adapterCommit !== 'string' || !/^[a-f0-9]{40}$/.test(proof.adapterCommit) ||
    typeof proof.room !== 'string' || !Number.isSafeInteger(proof.generation) || Number(proof.generation) < 0 ||
    typeof proof.capturedAt !== 'string' || !Number.isFinite(Date.parse(proof.capturedAt)) ||
    !proof.record || !proof.verification
  ) return false;
  try {
    assertTechnocoreRoomName(proof.room);
    const record = proof.record as unknown as Record<string, unknown>;
    const verification = proof.verification as unknown as Record<string, unknown>;
    if (
      Object.keys(record).length !== 6 ||
      !['seq', 'ts', 'from', 'text', 'nonce', 'sig'].every((key) => Object.hasOwn(record, key)) ||
      Object.keys(verification).length !== 4 ||
      verification.authorSignature !== 'valid' ||
      JSON.stringify(verification.signedFields) !== JSON.stringify(['room', 'nonce', 'text']) ||
      JSON.stringify(verification.serverFields) !== JSON.stringify(['seq', 'ts', 'generation']) ||
      verification.serverInclusionProof !== 'not_cryptographically_established'
    ) return false;
    const seq = record.seq;
    if (typeof seq !== 'string') return false;
    if (!/^\d+$/.test(seq) || BigInt(seq) < 1n || typeof record.ts !== 'string' || !Number.isFinite(Date.parse(record.ts))) return false;
    if (typeof record.from !== 'string' || typeof record.text !== 'string' || typeof record.nonce !== 'string' || typeof record.sig !== 'string') return false;
    return verifyTechnocoreMessage({ room: proof.room, did: record.from, text: record.text, nonce: record.nonce, sig: record.sig });
  } catch {
    return false;
  }
}
