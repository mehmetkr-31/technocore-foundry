/** Close Call desk reports: what the referee's public, signed flow proves about an operator's own messages.
 *
 * The referee lists only part of each sweep's outcomes and mints (issue #6). This module never infers a
 * balance: it classifies one message at a time as listed, hidden behind an `omitted` count, inside a
 * published `missed` range, or absent from complete lists, and signs that classification as a report. */
import { CC, closeDid, exactKeys } from './close-call';
import { base64UrlToBytes, bytesToBase64Url, canonicalJson, isCanonicalTechnocoreSignature, publicKeyFromDid, sha256Hex } from './foundry-crypto';
import { parseStrictJson } from './strict-json';

export const DESK_REPORT_SCHEMA = 'foundry-close-call-desk-report-v1' as const;
export const DESK_REPORT_DOMAIN = 'foundry-close-call-desk-report:v1' as const;
export const DESK_SUMMARY_TYPE = 'foundry-close-call-desk-summary-v1' as const;
const REGISTRATION_WINDOW = 3; // a mint is issued at the next sweep; allow two late sweeps
const MAX_KEYS = 32, MAX_PAIRS = 16, MAX_ATTEMPTS = 16;

export type FlowRecord = {
  n: number; ts: string; file: string; settled: string[]; void: [string, string][]; mints: string[];
  omitted: { mints: number; settled: number; void: number }; missed: [string, number, number][];
};
export type EvidenceStatus = 'settled' | 'void' | 'listed' | 'missed' | 'hidden' | 'absent' | 'pending';
export type Evidence = { status: EvidenceStatus; reason: string; sweep: number | null; hidden: number };
export type DeskMessage = { seq: string; postedAt: string };
export type DeskAttempt = DeskMessage & { id: string; px: string; qty: string; until: number; evidence: Evidence };
export type DeskKey = { name: string; did: string; role: 'operator' | 'desk'; registration: (DeskMessage & { evidence: Evidence }) | null };
export type DeskPair = { pair: number; long: string; short: string; status: string; attempts: DeskAttempt[] };
export type DeskReport = {
  schema: typeof DESK_REPORT_SCHEMA; season: 'close-1'; operator: string; createdAt: string;
  referee: { did: string; manifest: string; flowSweep: number; flowFile: string; priceSweep: number; ref: string };
  keys: DeskKey[]; pairs: DeskPair[];
  claims: { balances: 'not-proven'; settlement: 'referee-listed-only'; airdrop: 'not-guaranteed' };
};
export type SignedDeskReport = { report: DeskReport; signature: { algorithm: 'Ed25519'; domain: typeof DESK_REPORT_DOMAIN; value: string } };

const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);

/** A referee flow post (signature already verified by the caller) in the shape this module reads. */
export function parseFlow(value: Record<string, unknown>, ts: string): FlowRecord | null {
  if (value.t !== 'flow' || !Number.isSafeInteger(value.n)) return null;
  const omitted = (value.omitted && typeof value.omitted === 'object' ? value.omitted : {}) as Record<string, unknown>;
  return {
    n: value.n as number, ts, file: typeof value.file === 'string' ? value.file : '',
    settled: strings(value.settled), mints: strings(value.mints),
    void: (Array.isArray(value.void) ? value.void : []).filter((x): x is [string, string] =>
      Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string').map((x) => [x[0], x[1]]),
    omitted: { mints: count(omitted.mints), settled: count(omitted.settled), void: count(omitted.void) },
    missed: (Array.isArray(value.missed) ? value.missed : []).filter((x): x is [string, number, number] =>
      Array.isArray(x) && typeof x[0] === 'string' && Number.isSafeInteger(x[1]) && Number.isSafeInteger(x[2])),
  };
}

function inMissed(flows: FlowRecord[], room: string, seq: string) {
  const s = BigInt(seq);
  return flows.find((f) => f.missed.some(([r, a, b]) => r === room && BigInt(a) <= s && s <= BigInt(b))) ?? null;
}
function after(flows: FlowRecord[], postedAt: string) {
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) throw new Error('Geçersiz gönderim zamanı.');
  return flows.filter((f) => Date.parse(f.ts) > t);
}
const evidence = (status: EvidenceStatus, sweep: number | null = null, reason = '', hidden = 0): Evidence => ({ status, reason, sweep, hidden });

/** A signed trade in `close1`: listed outcome, or why the public flow cannot show one. */
export function classifyTrade(flows: FlowRecord[], trade: DeskMessage & { id: string; until: number }): Evidence {
  for (const f of flows) {
    if (f.settled.includes(trade.id)) return evidence('settled', f.n);
    const v = f.void.find(([id]) => id === trade.id);
    if (v) return evidence('void', f.n, v[1]);
  }
  const missed = inMissed(flows, CC.room, trade.seq);
  if (missed) return evidence('missed', missed.n, 'Hakem bu seq aralığını okumadığını yayımladı.');
  const latest = flows.reduce((m, f) => Math.max(m, f.n), 0);
  const eligible = after(flows, trade.postedAt).filter((f) => f.n <= trade.until);
  const hidden = eligible.reduce((m, f) => m + f.omitted.settled + f.omitted.void, 0);
  if (latest <= trade.until) return evidence('pending', null, '', hidden);
  if (hidden) return evidence('hidden', null, 'Uygun turlarda sonuçların bir kısmı yalnızca sayı olarak yayımlandı.', hidden);
  return evidence('absent', null, eligible.length ? 'Uygun turların listeleri eksiksizdi ve kimlik yok: hakem okumamış olabilir.'
    : 'Gönderimden sonra son tura kadar hakem turu yayımlanmadı.');
}

/** A signed `owner` registration: mint listed, hidden in `omitted.mints`, unread, or absent. */
export function classifyRegistration(flows: FlowRecord[], owner: DeskMessage & { did: string }): Evidence {
  const listed = flows.find((f) => f.mints.includes(owner.did));
  if (listed) return evidence('listed', listed.n);
  const missed = inMissed(flows, CC.room, owner.seq);
  if (missed) return evidence('missed', missed.n, 'Kayıt, hakemin okumadığı seq aralığında; kurallara göre yeniden kayıt gerekir.');
  const window = after(flows, owner.postedAt).sort((a, b) => a.n - b.n).slice(0, REGISTRATION_WINDOW);
  if (!window.length) return evidence('pending');
  const hidden = window.reduce((m, f) => m + f.omitted.mints, 0);
  if (hidden) return evidence('hidden', null, 'Tahsisler bu turlarda yalnızca sayı olarak yayımlandı.', hidden);
  if (window.length < REGISTRATION_WINDOW) return evidence('pending');
  return evidence('absent', null, 'Kayıttan sonraki tahsis listeleri eksiksizdi ve DID yok.');
}

/** A desk may retry until the lock; the report keeps every listed outcome and fills the rest with the newest. */
function attemptWindow(attempts: DeskAttempt[]) {
  const listed = attempts.filter((a) => a.evidence.status === 'settled' || a.evidence.status === 'void').slice(-MAX_ATTEMPTS);
  const room = MAX_ATTEMPTS - listed.length;
  const recent = room > 0 ? attempts.filter((a) => !listed.includes(a)).slice(-room) : [];
  return attempts.filter((a) => listed.includes(a) || recent.includes(a));
}

type DeskState = {
  registered: Record<string, { seq: number | string; ts: string }>;
  pairs: { pair: number; long: string; short: string; status: string;
    attempts: { id: string; px: string; qty: string; until: number; seq?: number | string; posted_at: number }[] }[];
};
export type ReportInput = {
  operator: string; createdAt: string; state: DeskState; keys: Record<string, string>; flows: FlowRecord[];
  price: { n: number; ref: string };
};

/** Build the unsigned report from the Python desk's `state.json`/`keys.json` and the verified referee flow. */
export function buildDeskReport(input: ReportInput): DeskReport {
  closeDid(input.operator);
  const flows = [...input.flows].sort((a, b) => a.n - b.n), last = flows.at(-1);
  if (!last) throw new Error('Hakem akış kaydı yok.');
  const names: Record<string, string> = { main: input.operator };
  for (const [name, did] of Object.entries(input.keys)) {
    if (name === 'main' || !/^k[0-9]{2}$/.test(name)) throw new Error(`Beklenmeyen anahtar adı: ${name}`);
    names[name] = closeDid(did);
  }
  const keys: DeskKey[] = Object.entries(names).map(([name, did]) => {
    const r = input.state.registered[name];
    const registration = r ? { seq: String(r.seq), postedAt: r.ts } : null;
    return { name, did, role: name === 'main' ? 'operator' : 'desk',
      registration: registration && { ...registration, evidence: classifyRegistration(flows, { ...registration, did }) } };
  });
  const pairs: DeskPair[] = input.state.pairs.map((p) => {
    if (!(p.long in names) || !(p.short in names)) throw new Error(`Çift ${p.pair}: bilinmeyen anahtar.`);
    const posted = p.attempts.filter((a) => a.seq !== undefined).map((a) => {
      const message = { seq: String(a.seq), postedAt: new Date(Math.round(a.posted_at * 1000)).toISOString() };
      return { id: a.id, px: a.px, qty: a.qty, until: a.until, ...message,
        evidence: classifyTrade(flows, { ...message, id: a.id, until: a.until }) };
    });
    return { pair: p.pair, long: p.long, short: p.short, status: p.status, attempts: attemptWindow(posted) };
  });
  const report: DeskReport = {
    schema: DESK_REPORT_SCHEMA, season: 'close-1', operator: input.operator, createdAt: input.createdAt,
    referee: { did: CC.referee, manifest: CC.manifest, flowSweep: last.n, flowFile: last.file, priceSweep: input.price.n, ref: input.price.ref },
    keys, pairs, claims: { balances: 'not-proven', settlement: 'referee-listed-only', airdrop: 'not-guaranteed' },
  };
  return validateDeskReport(report);
}

const STATUSES: EvidenceStatus[] = ['settled', 'void', 'listed', 'missed', 'hidden', 'absent', 'pending'];
function checkEvidence(value: unknown): Evidence {
  exactKeys(value, ['status', 'reason', 'sweep', 'hidden']);
  if (!STATUSES.includes(value.status as EvidenceStatus) || typeof value.reason !== 'string' || value.reason.length > 200 ||
    !(value.sweep === null || (Number.isSafeInteger(value.sweep) && (value.sweep as number) >= 0)) ||
    !Number.isSafeInteger(value.hidden) || (value.hidden as number) < 0) throw new Error('Geçersiz kanıt kaydı.');
  return value as Evidence;
}
function checkMessage(value: Record<string, unknown>) {
  if (typeof value.seq !== 'string' || !/^[0-9]{1,19}$/.test(value.seq) ||
    typeof value.postedAt !== 'string' || !Number.isFinite(Date.parse(value.postedAt))) throw new Error('Geçersiz mesaj kaydı.');
}
const money = /^[0-9]{1,7}(?:\.[0-9]{1,2})?$/;

/** Exact-shape validation; everything a signature covers is checked before it is trusted. */
export function validateDeskReport(value: unknown): DeskReport {
  exactKeys(value, ['schema', 'season', 'operator', 'createdAt', 'referee', 'keys', 'pairs', 'claims']);
  if (value.schema !== DESK_REPORT_SCHEMA || value.season !== CC.season || typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Bu bir close-1 masa raporu değil.');
  const operator = closeDid(value.operator);
  exactKeys(value.referee, ['did', 'manifest', 'flowSweep', 'flowFile', 'priceSweep', 'ref']);
  const ref = value.referee;
  if (ref.did !== CC.referee || ref.manifest !== CC.manifest || !Number.isSafeInteger(ref.flowSweep) ||
    !Number.isSafeInteger(ref.priceSweep) || typeof ref.flowFile !== 'string' || !/^[0-9a-f]{0,64}$/.test(ref.flowFile) ||
    typeof ref.ref !== 'string' || !money.test(ref.ref)) throw new Error('Hakem bağlamı sabit close-1 değerleriyle eşleşmiyor.');
  exactKeys(value.claims, ['balances', 'settlement', 'airdrop']);
  if (value.claims.balances !== 'not-proven' || value.claims.settlement !== 'referee-listed-only' || value.claims.airdrop !== 'not-guaranteed') throw new Error('Rapor iddiaları sınırların dışında.');
  if (!Array.isArray(value.keys) || !value.keys.length || value.keys.length > MAX_KEYS) throw new Error('Anahtar listesi geçersiz.');
  const names = new Set<string>(), dids = new Set<string>();
  for (const k of value.keys) {
    exactKeys(k, ['name', 'did', 'role', 'registration']);
    if (typeof k.name !== 'string' || !/^(main|k[0-9]{2})$/.test(k.name) || names.has(k.name)) throw new Error('Anahtar adı geçersiz.');
    const did = closeDid(k.did);
    if (dids.has(did) || k.role !== (k.name === 'main' ? 'operator' : 'desk') || (k.name === 'main') !== (did === operator)) throw new Error('Anahtar rolü veya DID geçersiz.');
    if (k.registration !== null) { exactKeys(k.registration, ['seq', 'postedAt', 'evidence']); checkMessage(k.registration); checkEvidence(k.registration.evidence); }
    names.add(k.name); dids.add(did);
  }
  if (!names.has('main')) throw new Error('Operatör anahtarı raporda yok.');
  if (!Array.isArray(value.pairs) || value.pairs.length > MAX_PAIRS) throw new Error('Çift listesi geçersiz.');
  for (const p of value.pairs) {
    exactKeys(p, ['pair', 'long', 'short', 'status', 'attempts']);
    if (!Number.isSafeInteger(p.pair) || typeof p.long !== 'string' || typeof p.short !== 'string' || !names.has(p.long) || !names.has(p.short) ||
      p.long === p.short || typeof p.status !== 'string' || !/^[a-z_]{1,24}$/.test(p.status) ||
      !Array.isArray(p.attempts) || p.attempts.length > MAX_ATTEMPTS) throw new Error('Çift kaydı geçersiz.');
    for (const a of p.attempts) {
      exactKeys(a, ['id', 'px', 'qty', 'until', 'seq', 'postedAt', 'evidence']);
      if (typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(a.id) || typeof a.px !== 'string' || !money.test(a.px) ||
        typeof a.qty !== 'string' || !money.test(a.qty) || !Number.isSafeInteger(a.until)) throw new Error('Deneme kaydı geçersiz.');
      checkMessage(a); checkEvidence(a.evidence);
    }
  }
  return value as unknown as DeskReport;
}

export function deskReportSigningBytes(report: DeskReport) {
  return new TextEncoder().encode(`${DESK_REPORT_DOMAIN}\0${canonicalJson(validateDeskReport(report))}`);
}
export async function signDeskReport(report: DeskReport, key: CryptoKey): Promise<SignedDeskReport> {
  const value = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519', key, deskReportSigningBytes(report))));
  return { report, signature: { algorithm: 'Ed25519', domain: DESK_REPORT_DOMAIN, value } };
}
/** Parse and verify a signed report from untrusted text. The operator DID is the only signer accepted. */
export async function verifyDeskReport(text: string): Promise<{ envelope: SignedDeskReport; sha256: string }> {
  if (text.length > 256 * 1024) throw new Error('Rapor dosyası çok büyük.');
  const envelope = parseStrictJson(text);
  exactKeys(envelope, ['report', 'signature']);
  exactKeys(envelope.signature, ['algorithm', 'domain', 'value']);
  const report = validateDeskReport(envelope.report);
  const sig = envelope.signature;
  if (sig.algorithm !== 'Ed25519' || sig.domain !== DESK_REPORT_DOMAIN || typeof sig.value !== 'string' || !isCanonicalTechnocoreSignature(sig.value)) throw new Error('İmza zarfı geçersiz.');
  const key = await crypto.subtle.importKey('raw', publicKeyFromDid(report.operator), { name: 'Ed25519' }, false, ['verify']);
  if (!(await crypto.subtle.verify('Ed25519', key, base64UrlToBytes(sig.value), deskReportSigningBytes(report)))) throw new Error('Operatör imzası geçersiz.');
  const signed = envelope as unknown as SignedDeskReport;
  return { envelope: signed, sha256: await sha256Hex(canonicalJson(signed)) };
}

/** The one-line pointer an operator posts in its own `d-` room; the full report travels as a file. */
export function deskSummary(report: DeskReport, sha256: string) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Geçersiz rapor özeti.');
  const text = canonicalJson({ t: DESK_SUMMARY_TYPE, season: report.season, report: sha256, flow: report.referee.flowSweep,
    pairs: report.pairs.map((p) => [p.pair, p.status, p.attempts.at(-1)?.evidence.status ?? 'none']) });
  if (text.length > 4096) throw new Error('Özet mesaj sınırını aşıyor.');
  return text;
}
