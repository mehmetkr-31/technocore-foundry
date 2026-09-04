import assert from 'node:assert/strict';
import {
  inspectTclkTechnocoreExport,
  inspectTclkTranscript,
  BrowserTclkError,
  TCLK_TRANSCRIPT_MAX_BYTES,
} from '../lib/browser-tclk-inspector.mjs';
import { createVault, signTechnocoreMessage } from '../lib/foundry-crypto.ts';

const payer = `did:key:z6Mk${'f'.repeat(44)}`;
const payee = `did:key:z6Mk${'g'.repeat(44)}`;
const offerId = '0xd001fbbf4fa36d9ab8ea88df02a8b3303539e9d59f7ff9d9bfeb679318e9ce75';
const contract = '0x2768bf32b455317879796093ff2e5882371cbec238611ca71f555a7fcbe58e1c';
const offer = `tclk1 {"amount":"1000000","asset":"FLOP","claimByMs":1756703600000,"expiresMs":1756700600000,"from":"${payer}","id":"${offerId}","job":{"context":"ctx-1","id":"task-3f","proto":"a2a"},"lock":"hash","nonce":"9f2c81d04c9e1f7a","rails":["flop-htlc","x402"],"refundAfterMs":1756707200000,"role":"payer","type":"offer"}`;
const accept = `tclk1 {"contract":"${contract}","from":"${payee}","nonce":"0011223344556677","ref":"${offerId}","statement":"0xabababababababababababababababababababababababababababababababab","type":"accept"}`;
const lock = `tclk1 {"contract":"${contract}","from":"${payer}","rail":"flop-htlc","ref":"escrow-123","type":"lock"}`;
const heartbeat = `tclk1 {"contract":"${contract}","from":"${payee}","nonce":"abcdef0123456789","type":"heartbeat"}`;
const wrongRefund = `tclk1 {"contract":"${contract}","from":"${payer}","ref":"wrong-ref","type":"refund"}`;
const refund = `tclk1 {"contract":"${contract}","from":"${payer}","ref":"escrow-123","type":"refund"}`;
const refundReceipt = `tclk1 {"contract":"${contract}","from":"${payee}","outcome":"refunded","rail":"flop-htlc","ref":"escrow-123","type":"receipt"}`;

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function asciiWire(json) {
  return json.replace(/[\u0080-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedDeal(payerDid, payeeDid) {
  const offerFields = {
    type: 'offer',
    from: payerDid,
    role: 'payer',
    amount: '1000000',
    asset: 'FLOP',
    lock: 'hash',
    rails: ['flop-htlc', 'x402'],
    claimByMs: 1756703600000,
    refundAfterMs: 1756707200000,
    expiresMs: 1756700600000,
    job: { proto: 'a2a', id: 'task-export', context: 'signed-export-test' },
    nonce: '9f2c81d04c9e1f7a',
  };
  const id = `0x${await hash(`FLOP::tclk::v1|offer|${asciiWire(canonicalJson(offerFields))}`)}`;
  const offerFrame = { ...offerFields, id };
  const acceptCore = {
    from: payeeDid,
    ref: id,
    statement: `0x${'ab'.repeat(32)}`,
    nonce: '0011223344556677',
  };
  const dealContract = `0x${await hash(`FLOP::tclk::v1|contract|${asciiWire(canonicalJson({ offer: offerFrame, accept: acceptCore }))}`)}`;
  const acceptFrame = { type: 'accept', ...acceptCore, contract: dealContract };
  return {
    offer: `tclk1 ${asciiWire(canonicalJson(offerFrame))}`,
    accept: `tclk1 ${asciiWire(canonicalJson(acceptFrame))}`,
    contract: dealContract,
  };
}

function exportRecord(seq, signed, overrides = {}) {
  return {
    seq,
    ts: new Date(Date.UTC(2026, 8, 2, 12, 0, seq)).toISOString(),
    from: signed.did,
    text: signed.text,
    nonce: Number(signed.nonce),
    sig: signed.sig,
    ...overrides,
  };
}

function jsonl(records) {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('TCLK inspector must never call fetch.'); };
try {
  const accepted = await inspectTclkTranscript(Buffer.from([offer, accept].join('\n')));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.layers.transportDid, 'not_checked');
  assert.equal(accepted.transport, null);
  assert.equal(accepted.contract, contract);

  const locked = await inspectTclkTranscript(Buffer.from([offer, accept, lock].join('\n')));
  assert.equal(locked.ok, true);
  assert.equal(locked.status, 'locked');
  assert.equal(locked.layers.railSettlement, 'not_checked');

  const live = await inspectTclkTranscript(Buffer.from([offer, accept, heartbeat, lock].join('\n')));
  assert.equal(live.ok, true);
  assert.equal(live.status, 'locked');
  assert.match(live.events[2].message, /state-neutral/);

  const refunded = await inspectTclkTranscript(Buffer.from([offer, accept, lock, refund, refundReceipt].join('\n')));
  assert.equal(refunded.ok, true);
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.layers.terminalReceipt, 'valid');

  const badRailReference = await inspectTclkTranscript(Buffer.from([offer, accept, lock, wrongRefund].join('\n')));
  assert.equal(badRailReference.ok, false);
  assert.equal(badRailReference.events.at(-1).state, 'invalid');

  const duplicate = await inspectTclkTranscript(Buffer.from([offer, accept, accept].join('\n')));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.layers.frameOrder, 'invalid');

  await assert.rejects(inspectTclkTranscript(Buffer.from(offer.replace('"amount"', '"z":1,"amount"'))), (cause) => cause instanceof BrowserTclkError && cause.code === 'SHAPE');
  await assert.rejects(inspectTclkTranscript(Buffer.from(offer.replace('"rails"', `"paymentKey":"0x02${'ff'.repeat(32)}","rails"`))), (cause) => cause instanceof BrowserTclkError && cause.code === 'SHAPE');
  await assert.rejects(inspectTclkTranscript(Buffer.from(offer.replace('"amount":"1000000","asset":"FLOP"', '"asset":"FLOP","amount":"1000000"'))), (cause) => cause instanceof BrowserTclkError && cause.code === 'CANONICAL');
  await assert.rejects(inspectTclkTranscript(Buffer.alloc(TCLK_TRANSCRIPT_MAX_BYTES + 1)), (cause) => cause instanceof BrowserTclkError && cause.code === 'FILE_SIZE');

  const room = 'tclk-export-test';
  const payerPassphrase = 'payer export passphrase';
  const payeePassphrase = 'payee export passphrase';
  const [payerVault, payeeVault] = await Promise.all([
    createVault(payerPassphrase),
    createVault(payeePassphrase),
  ]);
  const deal = await signedDeal(payerVault.did, payeeVault.did);
  const [signedOffer, signedNote, signedAccept, mismatchedOffer] = await Promise.all([
    signTechnocoreMessage(payerVault, payerPassphrase, room, deal.offer),
    signTechnocoreMessage(payerVault, payerPassphrase, room, 'Non-TCLK signed room note.'),
    signTechnocoreMessage(payeeVault, payeePassphrase, room, deal.accept),
    signTechnocoreMessage(payeeVault, payeePassphrase, room, deal.offer),
  ]);
  const badSignature = `${signedOffer.sig[0] === 'A' ? 'B' : 'A'}${signedOffer.sig.slice(1)}`;
  const roomExport = jsonl([
    exportRecord(1, signedOffer),
    { seq: 2, ts: '2026-09-02T12:00:02.000Z', from: 'legacy-observer', text: deal.accept },
    exportRecord(3, signedNote),
    exportRecord(4, signedOffer, { sig: badSignature }),
    exportRecord(5, signedAccept),
  ]);
  const verifiedExport = await inspectTclkTechnocoreExport(roomExport, room);
  assert.equal(verifiedExport.ok, true);
  assert.equal(verifiedExport.status, 'accepted');
  assert.equal(verifiedExport.contract, deal.contract);
  assert.equal(verifiedExport.layers.transportDid, 'valid');
  assert.equal(verifiedExport.transport?.totalRecords, 5);
  assert.equal(verifiedExport.transport?.selectedRecords, 2);
  assert.equal(verifiedExport.transport?.ignoredRecords, 3);
  assert.deepEqual(verifiedExport.transport?.signatureCounts, { valid: 3, invalid: 1, not_reverifiable: 0, unsigned: 1 });
  assert.equal(verifiedExport.transport?.authorsBound, true);
  assert.ok(verifiedExport.transport?.records.every((record) => record.authorMatches));
  assert.equal(verifiedExport.transport?.sequenceMetadata, 'server_asserted_unsigned');
  assert.equal(verifiedExport.transport?.timestampMetadata, 'server_asserted_unsigned');
  assert.equal(verifiedExport.transport?.generationMetadata, 'external_header_unsigned');
  assert.equal(verifiedExport.transport?.inclusionProof, 'not_cryptographically_established');

  const authorMismatch = await inspectTclkTechnocoreExport(jsonl([
    exportRecord(1, mismatchedOffer),
    exportRecord(2, signedAccept),
  ]), room);
  assert.equal(authorMismatch.ok, true);
  assert.equal(authorMismatch.layers.transportDid, 'invalid');
  assert.equal(authorMismatch.transport?.authorsBound, false);
  assert.equal(authorMismatch.transport?.records[0].recordDid, payeeVault.did);
  assert.equal(authorMismatch.transport?.records[0].frameDid, payerVault.did);

  await assert.rejects(
    inspectTclkTechnocoreExport(jsonl([
      { seq: 1, ts: '2026-09-02T12:00:01.000Z', from: 'legacy-observer', text: deal.offer },
    ]), room),
    (cause) => cause instanceof BrowserTclkError && cause.code === 'NO_SIGNED_TCLK',
  );
  await assert.rejects(
    inspectTclkTechnocoreExport(roomExport, 'Invalid Room'),
    (cause) => cause instanceof BrowserTclkError && cause.code === 'TECHNOCORE_EXPORT',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({ browserTclkInspector: 'ok', gates: ['official-golden-vectors', 'canonical-ascii-wire', 'contract-binding', 'order-replay', 'heartbeat', 'rail-ref-binding', 'receipt-binding', 'secp256k1-point-shape', 'technocore-jsonl-signatures', 'frame-author-binding', 'unsigned-server-metadata-boundary', 'no-fetch', 'bounds', 'transport-and-rail-caveats'] }));
