import { parseStrictJson } from './strict-json.ts';

export const TCLK_TRANSCRIPT_MAX_BYTES = 256 * 1024;
export const TCLK_TRANSCRIPT_MAX_FRAMES = 128;

const PREFIX = 'tclk1 ';
const DOMAIN = 'FLOP::tclk::v1';
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const HEX33 = /^0x[0-9a-f]{66}$/;
const AMOUNT = /^[1-9][0-9]*$/;
const ASSET = /^[A-Za-z0-9_-]{1,32}$/;
const RAIL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const NONCE = /^[0-9a-f]{8,64}$/;
const MAX_FRAME_CHARS = 4096;

export class BrowserTclkError extends Error {
  constructor(code, stage, message) {
    super(message);
    this.name = 'BrowserTclkError';
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage, message) {
  throw new BrowserTclkError(code, stage, message);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function allowedKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('CANONICAL', 'wire', 'Frame contains an unsupported JSON value.');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function asciiWire(json) {
  return json.replace(/[\u0080-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNSUPPORTED', 'crypto', 'This browser does not expose WebCrypto SHA-256.');
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? textBytes(value) : value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireString(value, name, expression) {
  if (typeof value !== 'string' || !value.length || (expression && !expression.test(value))) {
    fail('SHAPE', 'frame', `${name} is malformed.`);
  }
  return value;
}

function requireMs(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('SHAPE', 'frame', `${name} must be a positive Unix-millisecond integer.`);
  return value;
}

function validateJob(value) {
  if (!allowedKeys(value, ['proto', 'id', 'context']) || typeof value.proto !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(value.proto) || typeof value.id !== 'string' || !value.id ||
    (value.context !== undefined && (typeof value.context !== 'string' || !value.context))) {
    fail('SHAPE', 'frame', 'job is malformed.');
  }
}

async function offerId(fields) {
  return `0x${await sha256Hex(`${DOMAIN}|offer|${asciiWire(canonicalJson(fields))}`)}`;
}

async function contractId(offer, accept) {
  const core = { from: accept.from, ref: accept.ref, statement: accept.statement, paymentKey: accept.paymentKey, nonce: accept.nonce };
  return `0x${await sha256Hex(`${DOMAIN}|contract|${asciiWire(canonicalJson({ offer, accept: core }))}`)}`;
}

async function validateFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || typeof frame.type !== 'string') {
    fail('SHAPE', 'frame', 'Frame must be a JSON object with a known type.');
  }
  const type = frame.type;
  const shape = {
    offer: { allowed: ['type', 'from', 'role', 'amount', 'asset', 'lock', 'rails', 'claimByMs', 'refundAfterMs', 'expiresMs', 'paymentKey', 'job', 'nonce', 'id'], required: ['type', 'from', 'role', 'amount', 'asset', 'lock', 'rails', 'claimByMs', 'refundAfterMs', 'expiresMs', 'nonce', 'id'] },
    accept: { allowed: ['type', 'from', 'ref', 'statement', 'contract', 'paymentKey', 'nonce'], required: ['type', 'from', 'ref', 'statement', 'contract', 'nonce'] },
    lock: { allowed: ['type', 'from', 'contract', 'rail', 'ref', 'presig'], required: ['type', 'from', 'contract', 'rail', 'ref'] },
    reveal: { allowed: ['type', 'from', 'contract', 'secret'], required: ['type', 'from', 'contract', 'secret'] },
    refund: { allowed: ['type', 'from', 'contract', 'reason'], required: ['type', 'from', 'contract'] },
    cancel: { allowed: ['type', 'from', 'contract', 'reason'], required: ['type', 'from', 'contract'] },
    receipt: { allowed: ['type', 'from', 'contract', 'outcome', 'rail', 'ref'], required: ['type', 'from', 'contract', 'outcome'] },
  }[type];
  if (!shape || !allowedKeys(frame, shape.allowed) || !shape.required.every((key) => Object.hasOwn(frame, key))) {
    fail('SHAPE', 'frame', `Unknown, missing, or extra field on ${type}.`);
  }
  requireString(frame.from, 'from', DID);
  if (type === 'offer') {
    if (!['payer', 'payee'].includes(frame.role) || !AMOUNT.test(frame.amount) || !ASSET.test(frame.asset) || !['hash', 'point'].includes(frame.lock) ||
      !Array.isArray(frame.rails) || !frame.rails.length || !frame.rails.every((rail) => typeof rail === 'string' && RAIL.test(rail)) ||
      new Set(frame.rails).size !== frame.rails.length || !NONCE.test(frame.nonce) || !HEX32.test(frame.id)) fail('SHAPE', 'frame', 'Offer terms are malformed.');
    requireMs(frame.claimByMs, 'claimByMs'); requireMs(frame.refundAfterMs, 'refundAfterMs'); requireMs(frame.expiresMs, 'expiresMs');
    if (frame.claimByMs >= frame.refundAfterMs) fail('SHAPE', 'frame', 'claimByMs must be strictly before refundAfterMs.');
    if (frame.paymentKey !== undefined && (typeof frame.paymentKey !== 'string' || !HEX33.test(frame.paymentKey))) fail('SHAPE', 'frame', 'Offer paymentKey is malformed.');
    if (frame.lock === 'point' && frame.paymentKey === undefined) fail('SHAPE', 'frame', 'Point locks require a paymentKey.');
    if (frame.job !== undefined) validateJob(frame.job);
    const { id, ...fields } = frame;
    if (await offerId(fields) !== id) fail('OFFER_ID', 'binding', 'Offer id does not bind its canonical ASCII frame.');
  } else if (type === 'accept') {
    if (!HEX32.test(frame.ref) || !HEX32.test(frame.contract) || !/^0x(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(frame.statement) || !NONCE.test(frame.nonce) ||
      (frame.paymentKey !== undefined && (typeof frame.paymentKey !== 'string' || !HEX33.test(frame.paymentKey)))) fail('SHAPE', 'frame', 'Accept fields are malformed.');
  } else if (type === 'lock') {
    if (!HEX32.test(frame.contract) || !RAIL.test(frame.rail) || typeof frame.ref !== 'string' || !frame.ref) fail('SHAPE', 'frame', 'Lock fields are malformed.');
    if (frame.presig !== undefined && (!exactKeys(frame.presig, ['nonce', 's']) || !HEX33.test(frame.presig.nonce) || !/^0x[0-9a-f]{1,64}$/.test(frame.presig.s))) fail('SHAPE', 'frame', 'PTLC pre-signature reference is malformed.');
  } else if (type === 'reveal') {
    if (!HEX32.test(frame.contract) || !HEX32.test(frame.secret)) fail('SHAPE', 'frame', 'Reveal fields are malformed.');
  } else if (type === 'refund' || type === 'cancel') {
    if (!HEX32.test(frame.contract) || (frame.reason !== undefined && (typeof frame.reason !== 'string' || !frame.reason))) fail('SHAPE', 'frame', `${type} fields are malformed.`);
  } else if (!HEX32.test(frame.contract) || !['claimed', 'refunded', 'cancelled'].includes(frame.outcome) ||
    (frame.rail !== undefined && !RAIL.test(frame.rail)) || (frame.ref !== undefined && (typeof frame.ref !== 'string' || !frame.ref))) {
    fail('SHAPE', 'frame', 'Receipt fields are malformed.');
  }
  return frame;
}

async function analyzeFrames(frames) {
  const offers = frames.filter((frame) => frame.type === 'offer');
  if (offers.length !== 1 || frames[0]?.type !== 'offer') fail('TRANSCRIPT', 'sequence', 'A single-deal transcript must begin with exactly one offer.');
  const offer = offers[0];
  const events = [{ index: 1, type: 'offer', state: 'valid', message: 'Canonical offer id recomputed.' }];
  let status = 'proposed';
  let contract;
  let statement;
  let payer = offer.role === 'payer' ? offer.from : null;
  let payee = offer.role === 'payee' ? offer.from : null;
  let terminalReceipt = false;
  let revealed = false;
  let invalidCount = 0;

  for (let position = 1; position < frames.length; position += 1) {
    const frame = frames[position];
    const index = position + 1;
    let message = '';
    let valid = true;
    if (frame.type === 'offer') { valid = false; message = 'A transcript may not open a second contract.'; }
    else if (frame.type === 'accept') {
      if (status !== 'proposed') { valid = false; message = `accept is invalid after ${status}.`; }
      else if (frame.ref !== offer.id || frame.from === offer.from) { valid = false; message = 'accept must name this offer and come from the counterparty.'; }
      else if ((offer.lock === 'hash' && !HEX32.test(frame.statement)) || (offer.lock === 'point' && !HEX33.test(frame.statement)) || (offer.lock === 'point' && !frame.paymentKey)) { valid = false; message = 'accept statement or required point-lock key is invalid.'; }
      else {
        const expected = await contractId(offer, frame);
        if (frame.contract !== expected) { valid = false; message = 'contract id does not bind the offer and accept core.'; }
        else { contract = frame.contract; statement = frame.statement; status = 'accepted'; payer = offer.role === 'payee' ? frame.from : payer; payee = offer.role === 'payer' ? frame.from : payee; message = 'Contract id and counterparty binding verified.'; }
      }
    } else if (frame.type === 'lock') {
      if (status !== 'accepted' || frame.contract !== contract || frame.from !== payer || !offer.rails.includes(frame.rail)) { valid = false; message = 'lock must follow accept, name this contract, come from payer, and use an offered rail.'; }
      else { status = 'locked'; message = 'Payer lock announcement is ordered and rail is permitted.'; }
    } else if (frame.type === 'reveal') {
      if (status !== 'locked' || frame.contract !== contract || frame.from !== payee) { valid = false; message = 'reveal must follow lock and come from payee.'; }
      else if (offer.lock === 'point') { valid = false; message = 'Point-witness curve validation is intentionally unavailable in this browser profile.'; }
      else if (`0x${await sha256Hex(Uint8Array.from(frame.secret.slice(2).match(/../g), (byte) => Number.parseInt(byte, 16)))}` !== statement) { valid = false; message = 'Reveal secret does not open the hash statement.'; }
      else { status = 'claimed'; revealed = true; message = 'Hash witness opens the accepted statement.'; }
    } else if (frame.type === 'refund') {
      if (status !== 'locked' || frame.contract !== contract || frame.from !== payer) { valid = false; message = 'refund must follow lock and come from payer.'; }
      else { status = 'refunded'; message = 'Payer refund frame is ordered; timestamp evidence is still required.'; }
    } else if (frame.type === 'cancel') {
      if (!['proposed', 'accepted'].includes(status) || (status === 'accepted' && frame.contract !== contract) || ![payer, payee, offer.from].includes(frame.from)) { valid = false; message = 'cancel must be pre-lock and from a known party.'; }
      else { status = 'cancelled'; message = 'Pre-lock cancellation is ordered and party-bound.'; }
    } else if (frame.type === 'receipt') {
      if (!['claimed', 'refunded', 'cancelled'].includes(status) || frame.contract !== contract || ![payer, payee].includes(frame.from) || frame.outcome !== status) { valid = false; message = 'receipt must acknowledge this terminal state from a contract party.'; }
      else { terminalReceipt = true; message = 'Terminal acknowledgement matches the derived state.'; }
    }
    if (!valid) invalidCount += 1;
    events.push({ index, type: frame.type, state: valid ? 'valid' : 'invalid', message: valid ? message : `Rejected: ${message}` });
  }

  return {
    status,
    contract: contract ?? null,
    offer,
    events,
    invalidCount,
    layers: {
      canonicalFrames: invalidCount === 0 ? 'valid' : 'invalid',
      offerBinding: 'valid',
      contractBinding: contract ? 'valid' : 'absent',
      frameOrder: invalidCount === 0 ? 'valid' : 'invalid',
      hashWitness: offer.lock === 'hash' ? (revealed ? 'valid' : 'absent') : 'not_checked',
      terminalReceipt: terminalReceipt ? 'valid' : 'absent',
      transportDid: 'not_checked',
      deadlineEvidence: 'not_checked',
      railSettlement: 'not_checked',
    },
  };
}

export async function inspectTclkTranscript(bytes) {
  if (bytes.byteLength < 1 || bytes.byteLength > TCLK_TRANSCRIPT_MAX_BYTES) fail('FILE_SIZE', 'file', `Transcript must be between 1 byte and ${TCLK_TRANSCRIPT_MAX_BYTES} bytes.`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('UTF8', 'file', 'Transcript is not valid UTF-8.'); }
  const rawLines = source.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line).filter((line) => line.length);
  if (!rawLines.length || rawLines.length > TCLK_TRANSCRIPT_MAX_FRAMES) fail('FRAME_COUNT', 'profile', `Transcript must contain 1–${TCLK_TRANSCRIPT_MAX_FRAMES} non-empty frames.`);
  const frames = [];
  for (const [position, line] of rawLines.entries()) {
    if (line.length > MAX_FRAME_CHARS || !line.startsWith(PREFIX) || !/^[\x20-\x7e]*$/.test(line)) fail('WIRE', 'wire', `Line ${position + 1} is not a printable ASCII tclk1 frame.`);
    let frame;
    try { frame = parseStrictJson(line.slice(PREFIX.length)); } catch (cause) { fail('STRICT_JSON', 'wire', `Line ${position + 1} has invalid strict JSON: ${cause instanceof Error ? cause.message : 'parse failure'}`); }
    await validateFrame(frame);
    if (`${PREFIX}${asciiWire(canonicalJson(frame))}` !== line) fail('CANONICAL', 'wire', `Line ${position + 1} is not canonical tclk/1 wire JSON.`);
    frames.push(frame);
  }
  const analysis = await analyzeFrames(frames);
  return {
    ok: analysis.invalidCount === 0,
    frameCount: frames.length,
    ...analysis,
    caveats: [
      'Raw tclk1 text carries no verifiable Technocore transport signature or room record.',
      'No signed venue timestamp was supplied, so expiry, claim and refund deadlines are not checked.',
      'No settlement rail was queried; a lock announcement is not proof that funds were locked.',
      'A claimed hash witness proves only knowledge of the secret, not work quality, payment finality, identity, or reward eligibility.',
    ],
  };
}
