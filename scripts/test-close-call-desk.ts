import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildDeskReport, classifyRegistration, classifyTrade, deskReportSigningBytes, deskSummary, parseFlow,
  signDeskReport, verifyDeskReport, DESK_REPORT_DOMAIN, type FlowRecord } from '../lib/close-call-desk';
import { didFromPublicKey } from '../lib/foundry-crypto';
import { canonicalJson } from '../lib/strict-json';

// Synthetic referee flow. Shapes match the live d-close1-flow posts; no network, no production keys.
const T = Date.parse('2026-09-27T12:00:00Z'), at = (minutes: number) => new Date(T + minutes * 60_000).toISOString();
const keyPair = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  return { pair, did: didFromPublicKey(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
};
const [operator, k01, k02, stranger] = await Promise.all([keyPair(), keyPair(), keyPair(), keyPair()]);
const flow = (n: number, minutes: number, extra: Record<string, unknown> = {}) =>
  parseFlow({ t: 'flow', n, file: 'ab'.repeat(32), mints: [], settled: [], void: [], missed: [], ...extra }, at(minutes))!;
const flows: FlowRecord[] = [
  flow(10, 5, { settled: ['a'], void: [['b', 'funds']], mints: [k01.did], missed: [['close1', 100, 200], ['other', 300, 400]] }),
  flow(11, 10, { omitted: { settled: 5, mints: 3 } }),
  flow(12, 15),
  flow(13, 20),
  flow(14, 25),
];
assert.equal(parseFlow({ t: 'price', n: 1 }, at(0)), null);
assert.deepEqual(parseFlow({ t: 'flow', n: 2, void: [['x'], 'y', ['z', 'limits']], missed: [['close1', 1.5, 2]] }, at(0))!.void, [['z', 'limits']]);

const trade = (id: string, seq: string, minutes: number, until: number) => classifyTrade(flows, { id, seq, postedAt: at(minutes), until });
assert.deepEqual(trade('a', '1', 0, 99), { status: 'settled', reason: '', sweep: 10, hidden: 0 });
assert.equal(trade('b', '1', 0, 99).status, 'void');
assert.equal(trade('b', '1', 0, 99).reason, 'funds');
assert.equal(trade('c', '150', 0, 12).status, 'missed');
assert.equal(trade('c', '350', 0, 12).status, 'hidden', 'a missed range in another room does not cover close1');
assert.deepEqual(trade('d', '999', 6, 11), { status: 'hidden', reason: trade('d', '999', 6, 11).reason, sweep: null, hidden: 5 });
assert.equal(trade('e', '999', 11, 13).status, 'absent', 'complete lists after posting: the referee never listed it');
assert.equal(trade('f', '999', 21, 13).status, 'absent', 'no sweep between posting and expiry');
assert.equal(trade('g', '999', 11, 15).status, 'pending');
assert.equal(trade('g', '999', 11, 14).status, 'absent', 'the until sweep is published: decided, not pending');
assert.equal(trade('h', '999', 0, 11).hidden, 5);
assert.throws(() => trade('i', '1', Number.NaN, 12));

const owner = (did: string, seq: string, minutes: number) => classifyRegistration(flows, { did, seq, postedAt: at(minutes) });
assert.deepEqual(owner(k01.did, '1', 0), { status: 'listed', reason: '', sweep: 10, hidden: 0 });
assert.equal(owner(k02.did, '120', 0).status, 'missed');
assert.deepEqual([owner(k02.did, '999', 6).status, owner(k02.did, '999', 6).hidden], ['hidden', 3]);
assert.equal(owner(k02.did, '999', 11).status, 'absent');
assert.equal(owner(k02.did, '999', 16).status, 'pending', 'fewer than three sweeps since registration');
assert.equal(owner(k02.did, '999', 30).status, 'pending');

const state = {
  registered: { main: { seq: 5, ts: at(0) }, k01: { seq: 6, ts: at(0) }, k02: { seq: '999', ts: at(11) } },
  pairs: [
    { pair: 1, long: 'k01', short: 'k02', status: 'posted', attempts: [
      { id: 'b', px: '225.17', qty: '43.31', until: 12, seq: 7, posted_at: (T + 60_000) / 1000 },
      { id: 'unsent', px: '225.17', qty: '43.31', until: 12, posted_at: (T + 60_000) / 1000 }] },
    { pair: 2, long: 'main', short: 'k01', status: 'waiting', attempts: [] },
  ],
};
const input = { operator: operator.did, createdAt: at(26), state, keys: { k01: k01.did, k02: k02.did }, flows, price: { n: 14, ref: '225.18' } };
const report = buildDeskReport(input);
assert.deepEqual(report.keys.map((k) => [k.name, k.role, k.registration?.evidence.status]), [['main', 'operator', 'hidden'], ['k01', 'desk', 'listed'], ['k02', 'desk', 'absent']]);
assert.deepEqual(report.pairs[0].attempts.map((a) => [a.id, a.seq, a.evidence.status]), [['b', '7', 'void']], 'an attempt with no server seq was never posted');
assert.equal(report.referee.flowSweep, 14);
assert.throws(() => buildDeskReport({ ...input, keys: { main: k01.did } }));
assert.throws(() => buildDeskReport({ ...input, keys: { x1: k01.did } }));
assert.throws(() => buildDeskReport({ ...input, state: { ...state, pairs: [{ ...state.pairs[1], short: 'k09' }] } }));
assert.throws(() => buildDeskReport({ ...input, flows: [] }));

// A desk retrying until the lock: the report keeps the listed outcome and the newest attempts, in order.
const many = Array.from({ length: 40 }, (_, i) => ({ id: i === 3 ? 'a' : `r${i}`, px: '225.17', qty: '43.31', until: 12, seq: 100 + i, posted_at: (T + 60_000) / 1000 }));
const windowed = buildDeskReport({ ...input, state: { ...state, pairs: [{ ...state.pairs[0], attempts: many }] } }).pairs[0].attempts;
assert.equal(windowed.length, 16);
assert.deepEqual(windowed.map((a) => a.id), ['a', ...many.slice(-15).map((a) => a.id)]);
assert.equal(windowed[0].evidence.status, 'settled');

const signed = await signDeskReport(report, operator.pair.privateKey);
const text = JSON.stringify(signed);
const { sha256 } = await verifyDeskReport(text);
assert.match(sha256, /^[0-9a-f]{64}$/);
assert.equal((await verifyDeskReport(JSON.stringify(JSON.parse(text), null, 2))).sha256, sha256, 'whitespace does not change the digest');
type Mutable = Record<string, Record<string, unknown>>;
const tamper = async (edit: (value: Mutable) => void) => {
  const value = structuredClone(signed) as never as Mutable;
  edit(value);
  await assert.rejects(verifyDeskReport(JSON.stringify(value)));
};
await tamper((v) => { (v.report.pairs as { attempts: { evidence: { status: string } }[] }[])[0].attempts[0].evidence.status = 'settled'; });
await tamper((v) => { v.signature.domain = 'foundry-close-call-desk-report:v2'; });
await tamper((v) => { v.report.extra = 1; });
await tamper((v) => { (v.report.claims as Record<string, string>).balances = 'proven'; });
await tamper((v) => { (v.report.referee as Record<string, string>).did = stranger.did; });
await tamper((v) => { (v.report.keys as { did: string }[])[0].did = stranger.did; v.report.operator = stranger.did; });
await assert.rejects(verifyDeskReport(text.replace('"hidden":0', '"hidden":0.5')));
await assert.rejects(verifyDeskReport(`${text.slice(0, -1)},"report":{}}`), 'duplicate keys are rejected');
const other = await signDeskReport(report, stranger.pair.privateKey);
await assert.rejects(verifyDeskReport(JSON.stringify(other)), 'only the operator DID may sign');

const summary = JSON.parse(deskSummary(report, sha256));
assert.deepEqual(summary, { flow: 14, pairs: [[1, 'posted', 'void'], [2, 'waiting', 'none']], report: sha256, season: 'close-1', t: 'foundry-close-call-desk-summary-v1' });
assert.throws(() => deskSummary(report, 'x'));

// Cross-language: the desk signs in Python with `DOMAIN \0 json.dumps(sort_keys, compact, ensure_ascii=False)`.
const pySigner = await keyPair();
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pySigner.pair.privateKey));
const pyReport = { ...report, operator: pySigner.did, keys: report.keys.map((k) => (k.name === 'main' ? { ...k, did: pySigner.did } : k)) };
const python = spawnSync('python3', ['-c', `
import sys, json, base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
data = json.loads(sys.stdin.read())
key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(data['seed']))
payload = data['domain'] + '\\0' + json.dumps(data['report'], sort_keys=True, separators=(',', ':'), ensure_ascii=False)
print(base64.urlsafe_b64encode(key.sign(payload.encode())).decode().rstrip('='))
`], { input: JSON.stringify({ seed: Buffer.from(pkcs8.slice(-32)).toString('hex'), domain: DESK_REPORT_DOMAIN, report: pyReport }), encoding: 'utf8' });
if (python.status === 0) {
  const envelope = { report: pyReport, signature: { algorithm: 'Ed25519', domain: DESK_REPORT_DOMAIN, value: python.stdout.trim() } };
  await verifyDeskReport(JSON.stringify(envelope));
  assert.equal(new TextDecoder().decode(deskReportSigningBytes(pyReport)), `${DESK_REPORT_DOMAIN}\0${canonicalJson(pyReport)}`);
  console.log('Python imzası TypeScript doğrulayıcısından geçti.');
} else console.log(`Python cryptography yok; diller arası kontrol atlandı. ${python.stderr.split('\n').at(-2) ?? ''}`);

console.log('Close Call masa raporu: kanıt sınıflandırması, tam şekil doğrulama, operatör imzası, kurcalama ve özet testleri geçti. Ağ yok.');
