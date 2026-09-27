import assert from 'node:assert/strict';
import { observePaperRail, parsePaperHashNote, PAPER_RESPONSE_MAX_BYTES } from '../lib/tclk-paper-observer';
import { sha256Hex } from '../lib/foundry-crypto';

const contract = `0x${'ab'.repeat(32)}`;
const statement = `0x${'cd'.repeat(32)}`;
const terms = { contract, lock: 'hash' as const, statement, refundAfterMs: 1800003600000, rail: 'paper', ref: contract, transcriptStatus: 'locked' };
const body = (value: string) => `header\n\ntclkpaper1 ${value}`;
function response(text: string, status = 200, contentType = 'text/plain') {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { status, headers: { 'content-type': contentType } });
}
let calls = 0; const fetcher: typeof fetch = async (url, init) => { calls++; assert.equal(url, `https://technocore.chat/kv/tclk-paper-ab/${'ab'.repeat(7)}`); assert.deepEqual(init && { method: init.method, redirect: init.redirect, credentials: init.credentials }, { method: 'GET', redirect: 'error', credentials: 'omit' }); return response(body(`locked hash ${statement} ${terms.refundAfterMs}`)); };
assert.equal((await observePaperRail(terms, fetcher)).state, 'matching'); assert.equal(calls, 1);
const secret = `0x${'ef'.repeat(32)}`; const secretHash = `0x${await sha256Hex(Uint8Array.from(secret.slice(2).match(/../g)!, (x) => parseInt(x, 16)))}`;
assert.equal((await observePaperRail({ ...terms, statement: secretHash, transcriptStatus: 'claimed' }, async () => response(body(`claimed hash ${secretHash} ${terms.refundAfterMs} ${secret}`)))).state, 'matching');
assert.equal(parsePaperHashNote(`tclkpaper1 locked hash ${statement} ${terms.refundAfterMs}`)?.status, 'locked');
assert.equal((await observePaperRail(terms, async () => response('', 404))).state, 'missing');
assert.equal((await observePaperRail(terms, async () => response('', 429))).state, 'request-error');
assert.equal((await observePaperRail(terms, async () => response('', 500))).state, 'request-error');
assert.equal((await observePaperRail(terms, async () => response('', 302))).state, 'request-error');
assert.equal((await observePaperRail(terms, async () => { throw new Error('offline'); })).state, 'request-error');
assert.equal((await observePaperRail(terms, async () => response(body(`locked hash ${statement} ${terms.refundAfterMs}`), 200, 'application/json'))).state, 'malformed');
assert.equal((await observePaperRail(terms, async () => response(body(`locked hash ${statement} ${terms.refundAfterMs}`.replace('locked', 'locked locked'))))).state, 'malformed');
assert.equal((await observePaperRail(terms, async () => response(body(`locked hash ${'00'.repeat(32)} ${terms.refundAfterMs}`)))).state, 'malformed');
assert.equal((await observePaperRail({ ...terms, ref: '0x' + 'aa'.repeat(32) }, async () => { throw new Error('must not call'); })).state, 'mismatch');
assert.equal((await observePaperRail({ ...terms, rail: 'x402' }, async () => { throw new Error('must not call'); })).state, 'not-applicable');
assert.equal((await observePaperRail(terms, async () => response(body(`locked hash ${statement} ${terms.refundAfterMs}`), 200, 'text/plain; charset=utf-8'))).state, 'matching');
assert.equal((await observePaperRail(terms, async () => response(body(`locked hash ${statement} ${terms.refundAfterMs}`.replace(String(terms.refundAfterMs), '1'))))).state, 'mismatch');
assert.equal((await observePaperRail(terms, async () => response(body(`claimed hash ${statement} ${terms.refundAfterMs}`)))).state, 'malformed');
assert.equal((await observePaperRail({ ...terms, transcriptStatus: 'claimed' }, async () => response(body(`claimed hash ${statement} ${terms.refundAfterMs} ${'0x' + '11'.repeat(32)}`)))).state, 'mismatch');
assert.equal((await observePaperRail(terms, async () => response('x'.repeat(PAPER_RESPONSE_MAX_BYTES + 1)))).state, 'malformed');
const invalidUtf8 = await observePaperRail(terms, async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'text/plain' } }));
assert.equal(invalidUtf8.state, 'malformed'); assert.match(invalidUtf8.reason, /UTF-8/);
const badStatement = await observePaperRail(terms, async () => response(body(`locked hash 0x${'01'.repeat(32)} ${terms.refundAfterMs}`)));
assert.deepEqual(badStatement.mismatches, ['statement']);
const badStatus = await observePaperRail(terms, async () => response(body(`refunded hash ${statement} ${terms.refundAfterMs}`)));
assert.deepEqual(badStatus.mismatches, ['status']);
const duplicateNote = body(`locked hash ${statement} ${terms.refundAfterMs}`);
assert.equal((await observePaperRail(terms, async () => response(`${duplicateNote}\n${duplicateNote}`))).state, 'malformed');
const snapshot = await observePaperRail(terms, fetcher);
assert.equal(snapshot.responseSha256, await sha256Hex(new TextEncoder().encode(snapshot.responseText!)));
assert.equal(snapshot.trust.historicalFunding, 'not-established');
assert.equal(snapshot.trust.settlement, 'no-value-paper-rail');
assert.equal((await observePaperRail(terms, async () => new Response(new ReadableStream({ async start(c) { c.error(new Error('stream')); } }), { status: 200, headers: { 'content-type': 'text/plain' } }))).state, 'request-error');
assert.equal(parsePaperHashNote(`tclkpaper1 locked hash ${statement} ${terms.refundAfterMs} ${secret}`), null);
await assert.rejects(observePaperRail({ ...terms, contract: 'bad' }, async () => { throw new Error('must not call'); }));
const noFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('network'); }; try { assert.equal((await observePaperRail({ ...terms, rail: 'x402' })).state, 'not-applicable'); } finally { globalThis.fetch = noFetch; }
console.log(JSON.stringify({ tclkPaperObserver: 'ok', gates: ['matching', 'claimed-secret-bytes', 'missing', 'request-errors', 'malformed', 'mismatch', 'non-paper-no-fetch', 'fixed-get-policy', 'bounds'] }));
