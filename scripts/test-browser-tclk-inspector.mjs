import assert from 'node:assert/strict';
import { inspectTclkTranscript, BrowserTclkError, TCLK_TRANSCRIPT_MAX_BYTES } from '../lib/browser-tclk-inspector.mjs';

const payer = `did:key:z6Mk${'f'.repeat(44)}`;
const payee = `did:key:z6Mk${'g'.repeat(44)}`;
const offerId = '0xd001fbbf4fa36d9ab8ea88df02a8b3303539e9d59f7ff9d9bfeb679318e9ce75';
const contract = '0x2768bf32b455317879796093ff2e5882371cbec238611ca71f555a7fcbe58e1c';
const offer = `tclk1 {"amount":"1000000","asset":"FLOP","claimByMs":1756703600000,"expiresMs":1756700600000,"from":"${payer}","id":"${offerId}","job":{"context":"ctx-1","id":"task-3f","proto":"a2a"},"lock":"hash","nonce":"9f2c81d04c9e1f7a","rails":["flop-htlc","x402"],"refundAfterMs":1756707200000,"role":"payer","type":"offer"}`;
const accept = `tclk1 {"contract":"${contract}","from":"${payee}","nonce":"0011223344556677","ref":"${offerId}","statement":"0xabababababababababababababababababababababababababababababababab","type":"accept"}`;
const lock = `tclk1 {"contract":"${contract}","from":"${payer}","rail":"flop-htlc","ref":"escrow-123","type":"lock"}`;

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('TCLK inspector must never call fetch.'); };
try {
  const accepted = await inspectTclkTranscript(Buffer.from([offer, accept].join('\n')));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.layers.transportDid, 'not_checked');
  assert.equal(accepted.contract, contract);

  const locked = await inspectTclkTranscript(Buffer.from([offer, accept, lock].join('\n')));
  assert.equal(locked.ok, true);
  assert.equal(locked.status, 'locked');
  assert.equal(locked.layers.railSettlement, 'not_checked');

  const duplicate = await inspectTclkTranscript(Buffer.from([offer, accept, accept].join('\n')));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.layers.frameOrder, 'invalid');

  await assert.rejects(inspectTclkTranscript(Buffer.from(offer.replace('"amount"', '"z":1,"amount"'))), (cause) => cause instanceof BrowserTclkError && cause.code === 'SHAPE');
  await assert.rejects(inspectTclkTranscript(Buffer.from(offer.replace('"amount":"1000000","asset":"FLOP"', '"asset":"FLOP","amount":"1000000"'))), (cause) => cause instanceof BrowserTclkError && cause.code === 'CANONICAL');
  await assert.rejects(inspectTclkTranscript(Buffer.alloc(TCLK_TRANSCRIPT_MAX_BYTES + 1)), (cause) => cause instanceof BrowserTclkError && cause.code === 'FILE_SIZE');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({ browserTclkInspector: 'ok', gates: ['official-golden-vectors', 'canonical-ascii-wire', 'contract-binding', 'order-replay', 'no-fetch', 'bounds', 'transport-and-rail-caveats'] }));
