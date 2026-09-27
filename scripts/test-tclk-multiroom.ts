import assert from 'node:assert/strict';
import { createVault, signTechnocore } from '../packages/signer-cli/core.mjs';
import { canonicalJson, sha256Hex } from '../lib/foundry-crypto';
import { inspectTclkMultiroom, MULTIROOM_MAX_BYTES } from '../lib/tclk-multiroom';

const pass = 'multiroom-test-passphrase';
const payer = createVault(pass); const payee = createVault(pass);
const wire = (x: Record<string, unknown>) => `tclk1 ${canonicalJson(x)}`;
async function make() {
  const base = { type: 'offer', from: payer.did, role: 'payer', amount: '1', asset: 'FLOP', lock: 'hash', rails: ['paper'], claimByMs: 1800000000000, refundAfterMs: 1800003600000, expiresMs: 1799996400000, nonce: '1122334455667788', job: { proto: 'a2a', id: 'task-1' } };
  const offer = { ...base, id: `0x${await sha256Hex(`FLOP::tclk::v1|offer|${canonicalJson(base)}`)}` };
  const secret = `0x${'cd'.repeat(32)}`;
  const ac = { from: payee.did, ref: offer.id, statement: `0x${await sha256Hex(Buffer.from(secret.slice(2), 'hex'))}`, nonce: '8877665544332211' };
  const contract = `0x${await sha256Hex(`FLOP::tclk::v1|contract|${canonicalJson({ offer, accept: ac })}`)}`;
  const room = `mb-p-tclk-${contract.slice(2, 18)}`;
  const accept = { type: 'accept', ...ac, contract };
  const lock = { type: 'lock', from: payer.did, contract, rail: 'paper', ref: 'paper-1' };
  const reveal = { type: 'reveal', from: payee.did, contract, secret, ref: 'paper-1' };
  const receipt = { type: 'receipt', from: payee.did, contract, outcome: 'claimed', rail: 'paper', ref: 'paper-1' };
  type Vault = ReturnType<typeof createVault>;
  async function record(vault: Vault, text: string, seq: number, ts: string, nonce: string) {
    const s = signTechnocore(vault, pass, { room: 'tclk-offers', text, nonce });
    return { seq, ts, from: s.did, text: s.text, nonce: s.nonce, sig: s.sig };
  }
  async function dealRecord(vault: Vault, text: string, seq: number, ts: string, nonce: string) {
    const s = signTechnocore(vault, pass, { room, text, nonce });
    return { seq, ts, from: s.did, text: s.text, nonce: s.nonce, sig: s.sig };
  }
  const board = [await record(payer, wire(offer), 1, '2027-01-15T00:00:01Z', '1000000000000000001'), await record(payee, wire(accept), 2, '2027-01-15T00:00:02Z', '1000000000000000002')];
  const deal = [await dealRecord(payer, wire(lock), 1, '2027-01-15T00:00:03Z', '1000000000000000003'), await dealRecord(payee, wire(reveal), 2, '2027-01-15T00:00:04Z', '1000000000000000004'), await dealRecord(payee, wire(receipt), 3, '2027-01-15T00:00:05Z', '1000000000000000005')];
  const jsonl = (rows: unknown[]) => new TextEncoder().encode(rows.length ? `${rows.map((x) => JSON.stringify(x).replace(/"nonce":"(\d{19})"/g, '"nonce":$1')).join('\n')}\n` : '');
  return { contract, board, deal, jsonl, record, dealRecord, offer, room };
}
const fixture = await make();
const good = await inspectTclkMultiroom(fixture.jsonl(fixture.board), fixture.jsonl(fixture.deal), fixture.contract);
assert.equal(good.ok, true); assert.equal(good.verifiedStatus, 'claimed'); assert.equal(good.terminal, true); assert.equal(good.selectedRecords.length, 5); assert.equal(good.layers.settlement, 'not-checked');
assert.ok(good.selectedRecords.some((r) => r.seq === '1'));
const incomplete = await inspectTclkMultiroom(fixture.jsonl(fixture.board), new Uint8Array(), fixture.contract); assert.equal(incomplete.ok, true); assert.equal(incomplete.verifiedStatus, 'accepted');
const tampered = structuredClone(fixture.board); tampered[0].sig = (tampered[0].sig.startsWith('A') ? 'B' : 'A') + tampered[0].sig.slice(1); await assert.rejects(inspectTclkMultiroom(fixture.jsonl(tampered), fixture.jsonl(fixture.deal), fixture.contract));
await assert.rejects(inspectTclkMultiroom(fixture.jsonl(fixture.board), fixture.jsonl(fixture.deal), 'bad-contract'));
await assert.rejects(inspectTclkMultiroom(fixture.jsonl(fixture.board.slice().reverse()), fixture.jsonl(fixture.deal), fixture.contract));
await assert.rejects(inspectTclkMultiroom(new TextEncoder().encode(''), fixture.jsonl(fixture.deal), fixture.contract));
await assert.rejects(inspectTclkMultiroom(new Uint8Array(MULTIROOM_MAX_BYTES + 1), fixture.jsonl(fixture.deal), fixture.contract));
const noFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('network'); }; try { await inspectTclkMultiroom(fixture.jsonl(fixture.board), fixture.jsonl(fixture.deal), fixture.contract); } finally { globalThis.fetch = noFetch; }
const run = (board = fixture.board, deal = fixture.deal) => inspectTclkMultiroom(fixture.jsonl(board), fixture.jsonl(deal), fixture.contract);
const wrongAuthor = await fixture.record(payer, fixture.board[1].text, 2, fixture.board[1].ts, '1000000000000000099');
await assert.rejects(run([fixture.board[0], wrongAuthor]), /imza/);
const misplaced = await fixture.record(payer, fixture.deal[0].text, 3, fixture.deal[0].ts, '1000000000000000098');
await assert.rejects(run([...fixture.board, misplaced], fixture.deal.slice(1)), /odada/);
const wrongSignatureRoom = await fixture.record(payer, fixture.deal[0].text, 1, fixture.deal[0].ts, '1000000000000000097');
await assert.rejects(run(fixture.board, [wrongSignatureRoom, ...fixture.deal.slice(1)]), /imza/);
await assert.rejects(run([...fixture.board, { ...fixture.board[1], seq: 3 }]), /yinelenmiş/);
const unrelated = await fixture.record(payer, 'Unrelated public board message', 3, fixture.deal[0].ts, '1000000000000000096');
assert.equal((await run([...fixture.board, unrelated])).ignoredRecords, 1);
assert.equal((await run()).selectedRecords[0].seq, '1');
const expiry = new Date(fixture.offer.expiresMs).toISOString();
const expired = await run([fixture.board[0], { ...fixture.board[1], ts: expiry }], []);
assert.equal(expired.ok, false); assert.equal(expired.verifiedStatus, null);
assert.equal((await run([fixture.board[0], { ...fixture.board[1], ts: new Date(fixture.offer.expiresMs - 1).toISOString() }], [])).ok, true);
const boundary = fixture.offer.refundAfterMs;
const lateLock = await run(fixture.board, [{ ...fixture.deal[0], ts: new Date(boundary).toISOString() }]);
assert.equal(lateLock.ok, false); assert.equal(lateLock.verifiedStatus, null);
const lateReveal = await run(fixture.board, [fixture.deal[0], { ...fixture.deal[1], ts: new Date(boundary).toISOString() }]);
assert.equal(lateReveal.ok, false);
assert.equal((await run(fixture.board, [fixture.deal[0], { ...fixture.deal[1], ts: new Date(boundary - 1).toISOString() }])).ok, true);
const refund = await fixture.dealRecord(payer, wire({ type: 'refund', from: payer.did, contract: fixture.contract, ref: 'paper-1' }), 2, new Date(boundary).toISOString(), '1000000000000000095');
assert.equal((await run(fixture.board, [fixture.deal[0], refund])).verifiedStatus, 'refunded');
assert.equal((await run(fixture.board, [fixture.deal[0], { ...refund, ts: new Date(boundary - 1).toISOString() }])).ok, false);
assert.equal((await run(fixture.board, [{ ...fixture.deal[0], ts: fixture.board[0].ts }])).ok, false);
const noLock = await run(fixture.board, fixture.deal.slice(1));
assert.equal(noLock.ok, false); assert.equal(noLock.verifiedStatus, null);
assert.equal(incomplete.terminal, false);
console.log(JSON.stringify({ tclkMultiroom: 'ok', gates: ['two-room-signed-chain', 'incomplete-chain', 'signature-tamper', 'contract-shape', 'append-order', 'bounds', 'no-fetch', 'unsigned-settlement-boundary'] }));
