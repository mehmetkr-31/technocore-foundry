import assert from 'node:assert/strict';
import { CC, cents, checkTradeWindow, makeTerms, makerPayload, parseOffer, signCloseAction,
  takerPayload, tradePreview, validateCloseMessage, verifyCloseSignature, type CloseOffer } from '../lib/close-call';
import { bytesToBase64Url, createVault, signTechnocoreMessage, unlockVault } from '../lib/foundry-crypto';
import { handleCloseGet, handleClosePost, readCloseSnapshot } from '../lib/close-call-service';

// Public, real referee fixtures. No private production keys or network needed.
const seed = { seq: 1, ts: '2026-09-25T12:05:22.575364Z', from: CC.referee,
  text: '{"for":1,"limits":["214.84","237.44"],"package":"bae09812e25eb6f1369c611f24964f7ea0acafddfc45301a16f33f941296dafa","price":"226.14","rooms":["d-close1-flow","d-close1-state","d-close1-price","d-close1-positions","d-close1-pnl"],"season":"close-1","t":"seed","trade":{"tid":626256716983248,"time":"2026-09-25T11:59:42.666000Z"}}',
  nonce: 1790337922535, sig: 'j3_asvvwrt67C13PdoA2Q1p0QfO24av1hvkC_2Nc5FJet9dKey97CFuKv1ZW9G7Ki4hxw86K-2dfhIjAjhlsCw' };
const price = { seq: 2, ts: '2026-09-25T12:05:22.824751Z', from: CC.referee,
  text: '{"age_s":13,"applied":"226.14","file":"b71f2587d5a0963037232439985a1d939fd5e0766a968fe7117ecd8b20a29da4","for":2,"global":"226.14","limits":["214.95","237.57"],"n":1,"ref":{"px":"226.26","tid":801176715797948,"time":"2026-09-25T12:04:46.823000Z"},"t":"price"}',
  nonce: 1790337922787, sig: 'DvfbMU2w1jH7cVi_XSPeQQrZtgljPf-Fmk6dNbsRl08pZlSodAagEn6Y9HgtG0tekgxp3cOuObtYLtX4v11lDA' };
const now = Date.parse('2026-09-25T12:06:00Z');
async function atFixedClock<T>(work: () => Promise<T>) {
  const original = Date.now;
  Date.now = () => now;
  try { return await work(); } finally { Date.now = original; }
}
const pass = 'Synthetic-test-vault-passphrase';
const maker = await createVault(pass), taker = await createVault(pass);
const terms = makeTerms({ id: 'test-trade-1', maker: maker.did, px: '226.26', qty: '0.10', side: 'buy', taker: 'any', until: 3 });
assert.equal(makerPayload(terms), `close-1|terms|${JSON.stringify(terms)}`);
assert.equal(takerPayload(terms, taker.did), `close-1|accept|${JSON.stringify(terms)}|${taker.did}`);
for (const amount of ['0', '-1', '1e2', '1.001', 'NaN', 12, '10000000']) assert.throws(() => cents(amount));
assert.throws(() => makeTerms({ ...terms, qty: '0.09' }));
assert.throws(() => makeTerms({ ...terms, until: 2557 }));
assert.throws(() => makeTerms({ ...terms, until: 1.5 }));
assert.throws(() => makeTerms({ ...terms, extra: 1 } as typeof terms));
const metrics = tradePreview({ ...terms, px: '200', qty: '2' }, false, '210');
assert.deepEqual(metrics, { side: 'buy', notional: '400', baseFee: '4', estimatedFee: '20', collateral: '400' });
assert.equal(tradePreview({ ...terms, px: '200', qty: '2' }, true, '210').estimatedFee, '4');
assert.equal(tradePreview({ ...terms, px: '0.01', qty: '0.1' }, false, '0.01').baseFee, '0.00001');
const livePrice = { n: 1, ref: '226.26', limits: ['214.95', '237.57'] as [string, string], postedAt: price.ts };
checkTradeWindow(terms, livePrice, now);
assert.throws(() => checkTradeWindow({ ...terms, until: 1 }, livePrice, now));
assert.throws(() => checkTradeWindow({ ...terms, px: '214.94' }, livePrice, now));
assert.throws(() => checkTradeWindow(terms, livePrice, now + 1_000_000));
assert.throws(() => checkTradeWindow(terms, { ...livePrice, postedAt: new Date(now + 1_000_000).toISOString() }, now + 1_000_000));
assert.throws(() => checkTradeWindow(terms, livePrice, CC.lock));
const offerMessage = await atFixedClock(() => signCloseAction(maker, pass, { kind: 'offer', terms }, '999999999999999998'));
assert.equal(offerMessage.nonce, '999999999999999999');
const offer = await parseOffer(offerMessage.text);
await validateCloseMessage(offerMessage);
assert.equal(await verifyCloseSignature(maker.did, makerPayload(terms), offer.maker_sig), true);
assert.equal(await verifyCloseSignature(taker.did, makerPayload(terms), offer.maker_sig), false);
await assert.rejects(() => parseOffer(JSON.stringify({ ...offer, terms: { ...terms, qty: '4' } })));
await assert.rejects(() => parseOffer(offerMessage.text.replace('"qty":"0.10"', '"qty":"0.10","qty":"2"')));
await assert.rejects(() => atFixedClock(() => signCloseAction(maker, pass, { kind: 'accept', offer })));
const reservedMsg = await atFixedClock(() => signCloseAction(maker, pass, { kind: 'offer', terms: { ...terms, taker: maker.did } }));
await assert.rejects(() => atFixedClock(() => signCloseAction(taker, pass, { kind: 'accept', offer: JSON.parse(reservedMsg.text) as CloseOffer })));
const accepted = await atFixedClock(() => signCloseAction(taker, pass, { kind: 'accept', offer }));
assert.equal((await validateCloseMessage(accepted)).kind, 'accept');
const alteredTrade = await signTechnocoreMessage(taker, pass, CC.room, accepted.text.replace('"qty":"0.10"', '"qty":"2"'));
await assert.rejects(() => validateCloseMessage(alteredTrade));
const owner = await atFixedClock(() => signCloseAction(maker, pass, { kind: 'owner' }));
assert.equal((await validateCloseMessage(owner)).kind, 'owner');

let posts = 0, badSeed = false, badAck = false;
const upstreamFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  assert.ok(url.startsWith('https://technocore.chat/r/'), 'No caller-defined SSRF target');
  if (init?.method === 'POST') {
    posts++;
    const m = JSON.parse(String(init.body));
    // Emit a number token, not a JS-rounded nonce. Production parser preserves 19 digits.
    const room = new URL(url).pathname.split('/').at(-1);
    return new Response(`{"room":"${room}","generation":1,"posted":{"seq":7,"ts":"${price.ts}","from":${JSON.stringify(m.did)},"text":${JSON.stringify(badAck ? 'wrong' : m.text)},"nonce":${m.nonce},"sig":${JSON.stringify(m.sig)}}}`);
  }
  if (url.endsWith('/d-close1-price/export')) return new Response([badSeed ? { ...seed, text: seed.text.replace(CC.manifest, 'a'.repeat(64)) } : seed, price].map(x => JSON.stringify(x)).join('\n'));
  if (url.includes('?format=json&limit=200')) {
    const key = await unlockVault(maker, pass), nonce = '9999999999999999999', text = '{"t":"owner","season":"close-1","key":"'+maker.did+'"}';
    const sig = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(`close1|${nonce}|${text}`))));
    return new Response(`{"messages":[{"seq":5,"ts":"${price.ts}","from":"${maker.did}","nonce":${nonce},"text":${JSON.stringify(text)},"sig":"${sig}"}]}`);
  }
  return new Response('');
};
const deps = { upstreamFetch, now: () => now };
const snap = await readCloseSnapshot(maker.did, deps);
assert.equal(snap.verified, true); assert.equal(snap.registration, 'unknown');
assert.equal((await readCloseSnapshot(maker.did, { ...deps, now: () => CC.lock })).verified, false);
const req = (message = owner, origin = 'http://localhost:3000', extra = {}) => new Request('http://localhost:3000/api/close-call', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'publish_close_call', message, ...extra }) });
assert.equal((await handleClosePost(req(owner, 'https://evil.example'), deps)).status, 403);
assert.equal((await handleClosePost(req(owner, 'http://localhost:3000', { passphrase: 'do-not-accept' }), deps)).status, 400);
assert.equal(posts, 0);
badSeed = true;
assert.equal((await handleClosePost(req(), deps)).status, 400); assert.equal(posts, 0);
badSeed = false;
assert.equal((await handleClosePost(req(), { ...deps, now: () => CC.lock })).status, 400); assert.equal(posts, 0);
const result = await handleClosePost(req(), deps);
assert.equal(result.status, 200, await result.clone().text());
const published = await result.json() as { status: string; proof: { record: { nonce: string } } };
assert.equal(published.status, 'posted'); assert.equal(published.proof.record.nonce, owner.nonce); assert.equal(posts, 1);
badAck = true; assert.equal((await handleClosePost(req(), deps)).status, 400); assert.equal(posts, 2, 'No automatic retry on uncertain ack');
const nonceResponse = await handleCloseGet(new Request(`http://localhost:3000/api/close-call?kind=nonce&room=close1&did=${maker.did}`), deps);
assert.equal((await nonceResponse.json() as { nonce: string }).nonce, '9999999999999999999');
assert.equal((await handleCloseGet(new Request('https://public.example/api/close-call'), deps)).status, 403);
assert.equal((await handleCloseGet(new Request(`http://localhost:3000/api/close-call?kind=nonce&room=https://evil.example&did=${maker.did}`), deps)).status, 502);
console.log('Close Call: protocol, exact fees, dual signatures, malformed/expired offers, pinned seed, local origin, fail-closed writes, lossless nonce and exact acknowledgement tests passed. No live writes.');
