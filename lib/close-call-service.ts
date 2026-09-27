import { CC, CC_REFEREE_ROOMS, assertCloseOpen, checkTradeWindow, closeDid, exactKeys, parseOffer,
  validateCloseMessage, type CloseSnapshot, type CloseOffer } from './close-call';
import { verifyTechnocoreMessage, type TechnocoreSignedMessage } from './foundry-crypto';
import { parseTechnocoreAcknowledgement } from './technocore-records';
import { decodeStrictUtf8, parseLosslessIntegerJsonBytes, parseStrictJson, parseStrictJsonBytes } from './strict-json';

const ORIGIN = 'https://technocore.chat';
const encoder = new TextEncoder();
type Dependencies = { upstreamFetch: typeof fetch; now?: () => number };
type RecordProof = { room: string; seq: string; ts: string; from: string; text: string; nonce: string; sig: string };
type DecodedRecord = { proof: RecordProof; value: Record<string, unknown> };

function local(request: Request, write = false) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    (origin === url.origin || (!write && origin === null)) &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
}
async function bytes(body: Request | Response, maximum: number) {
  if (Number(body.headers.get('content-length') || 0) > maximum) throw new Error('Yanıt/istek boyutu sınırı aşıldı.');
  if (!body.body) return new Uint8Array();
  const reader = body.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('Yanıt/istek boyutu sınırı aşıldı.');
      chunks.push(value);
    }
  } catch (e) { await reader.cancel().catch(() => undefined); throw e; }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
async function upstream(path: string, deps: Dependencies, init: RequestInit = {}) {
  const response = await deps.upstreamFetch(`${ORIGIN}${path}`, { ...init, redirect: 'manual', cache: 'no-store',
    signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', ...init.headers } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Technocore HTTP ${response.status}. Otomatik tekrar yapılmadı.`); }
  return response;
}
function integer(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Tam sayı gerekli.');
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Yuvarlanmış sayı reddedildi.');
  if (BigInt(value) < 0n) throw new Error('Negatif sayı reddedildi.');
  return String(value);
}
async function decodeRecord(value: unknown, room: string): Promise<DecodedRecord | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.from !== 'string' || typeof r.text !== 'string' || typeof r.sig !== 'string' || typeof r.ts !== 'string') return null;
  const message: TechnocoreSignedMessage = { room, did: r.from, text: r.text, sig: r.sig, nonce: integer(r.nonce) };
  if (!(await verifyTechnocoreMessage(message))) return null;
  const parsed = parseStrictJson(r.text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { proof: { room, seq: integer(r.seq), ts: r.ts, from: r.from, text: r.text, nonce: message.nonce, sig: r.sig }, value: parsed as Record<string, unknown> };
}
async function records(room: string, deps: Dependencies, referee = true) {
  const response = await upstream(`/r/${room}/export`, deps);
  const raw = await bytes(response, 16 * 1024 * 1024);
  const lines = decodeStrictUtf8(raw).split('\n').filter(Boolean);
  // Referee rooms currently publish one record per sweep. Full season fits this bound.
  if (referee && lines.length > 3000) throw new Error('Hakem kayıt sayısı incelenen sınırı aştı.');
  const selected = referee ? lines : lines.slice(-500);
  const result: DecodedRecord[] = [];
  for (const line of selected) {
    if (line.length > 32 * 1024) throw new Error('Kayıt boyutu sınırı aşıldı.');
    const r = parseLosslessIntegerJsonBytes(encoder.encode(line)) as Record<string, unknown>;
    if (referee && r.from !== CC.referee) continue;
    try {
      const entry = await decodeRecord(r, room);
      if (entry) result.push(entry);
      else if (referee) throw new Error('Hakem imzası geçersiz.');
    } catch (e) { if (referee) throw e; /* Ignore malformed public offers, never execute them. */ }
  }
  return result;
}
export async function readCloseSnapshot(did: string | null, deps: Dependencies): Promise<CloseSnapshot> {
  if (did) closeDid(did);
  const now = (deps.now ?? Date.now)();
  const out: CloseSnapshot = { verified: false, reason: '', checkedAt: new Date(now).toISOString(), price: null,
    registration: 'unknown', mintEvidence: null, offers: [], outcomes: [], leaderboard: [], warnings: [], evidence: [] };
  const [prices, flows, pnl, offers] = await Promise.all([
    records('d-close1-price', deps), records('d-close1-flow', deps), records('d-close1-pnl', deps),
    records(CC.offersRoom, deps, false).catch(() => { out.warnings.push('Teklif odası okunamadı; ortak JSON teklifi elle yüklenebilir.'); return []; }),
  ]);
  const seed = prices.find((r) => r.value.t === 'seed');
  if (!seed || seed.value.season !== CC.season || seed.value.package !== CC.manifest ||
    !Array.isArray(seed.value.rooms) || [...seed.value.rooms].sort().join('|') !== [...CC_REFEREE_ROOMS].sort().join('|')) throw new Error('Başlangıç kaydı sabit hakem/paket/odalar ile eşleşmiyor.');
  out.evidence.push(seed.proof);
  const latest = prices.filter((r) => r.value.t === 'price').at(-1);
  if (latest) {
    const v = latest.value, ref = v.ref as Record<string, unknown>;
    if (typeof v.n !== 'number' || !Array.isArray(v.limits) || v.limits.length !== 2 || typeof ref?.px !== 'string' ||
      v.limits.some((s) => typeof s !== 'string') || v.for !== v.n + 1) throw new Error('Hakem fiyat şekli değişmiş; yazma kapalı.');
    out.price = { n: v.n, ref: ref.px, limits: v.limits as [string, string], postedAt: latest.proof.ts };
    out.evidence.push(latest.proof);
    try {
      checkTradeWindow({ id: 'freshness-check', maker: CC.referee, px: ref.px, qty: '0.1', side: 'buy', taker: 'any', until: v.n + 1 }, out.price, now);
      out.verified = true; out.reason = 'Sabit hakem imzası, başlangıç paketi ve güncel tur doğrulandı.';
    } catch (e) { out.reason = (e as Error).message; }
  } else out.reason = 'İlk fiyat turu henüz bulunamadı.';
  for (const r of flows) {
    const v = r.value;
    if (v.t !== 'flow' || typeof v.n !== 'number' || !Number.isSafeInteger(v.n)) continue;
    if (Array.isArray(v.mints) && did && v.mints.includes(did)) {
      out.registration = 'mint_observed'; out.mintEvidence = r.proof;
    }
    if (Array.isArray(v.settled)) for (const id of v.settled) if (typeof id === 'string') out.outcomes.push({ id, status: 'settled', reason: '', sweep: v.n });
    if (Array.isArray(v.void)) for (const item of v.void) if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') out.outcomes.push({ id: item[0], status: 'void', reason: item[1], sweep: v.n });
  }
  out.outcomes = out.outcomes.slice(-3000);
  if (flows.length) out.evidence.push(flows.at(-1)!.proof);
  if (out.mintEvidence) out.evidence.push(out.mintEvidence);
  const latestPnl = pnl.filter((r) => r.value.t === 'pnl').at(-1);
  if (latestPnl && Array.isArray(latestPnl.value.top)) { out.leaderboard = latestPnl.value.top.slice(0, 25); out.evidence.push(latestPnl.proof); }
  const seen = new Set<string>();
  for (const r of offers.reverse()) {
    try {
      const offer: CloseOffer = await parseOffer(r.proof.text);
      if (offer.terms.maker !== r.proof.from || seen.has(offer.terms.id)) continue;
      checkTradeWindow(offer.terms, out.price, now);
      if (out.outcomes.some((o) => o.id === offer.terms.id && o.status === 'settled')) continue;
      seen.add(offer.terms.id); out.offers.push(offer);
      if (out.offers.length >= 50) break;
    } catch { /* Invalid, expired or out-of-range is not an available offer. */ }
  }
  out.warnings.push('Kamuya açık mint/işlem listeleri eksik olabilir (resmî issue #6). Yokluk ret veya sıfır bakiye değildir.',
    '10.000 POLF ilk tahsistir; kullanılabilir güncel bakiye bu kayıtlardan kesin hesaplanamaz.',
    'Teklifler son 500 oda kaydından taranır; açık görünmesi hâlâ kabul edilebilir olduğunu garanti etmez.',
    'İşlem sonuçları yalnızca kimlik (id) ile listelenir; tam şartların arşiv kanıtı yerine geçmez.');
  return out;
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function handleCloseGet(request: Request, deps: Dependencies) {
  if (!local(request)) return json({ error: 'Bu API yalnızca yerel Foundry için açıktır.' }, 403);
  try {
    const url = new URL(request.url), did = url.searchParams.get('did');
    if (url.searchParams.get('kind') === 'nonce') {
      closeDid(did); const room = url.searchParams.get('room');
      if (room !== CC.room && room !== CC.offersRoom) throw new Error('Oda izinli değil.');
      const response = await upstream(`/r/${room}?format=json&limit=200`, deps);
      const body = parseLosslessIntegerJsonBytes(await bytes(response, 1024 * 1024)) as Record<string, unknown>;
      let nonce: string | null = null;
      if (!Array.isArray(body.messages)) throw new Error('Nonce yanıtı tanınmadı.');
      for (const r of body.messages) {
        if (!r || typeof r !== 'object' || (r as Record<string, unknown>).from !== did) continue;
        const entry = await decodeRecord(r, room);
        if (entry && (nonce === null || BigInt(entry.proof.nonce) > BigInt(nonce))) nonce = entry.proof.nonce;
      }
      return json({ nonce });
    }
    return json(await readCloseSnapshot(did, deps));
  } catch (e) { return json({ error: (e as Error).message }, 502); }
}
export async function handleClosePost(request: Request, deps: Dependencies) {
  if (!local(request, true)) return json({ error: 'Yerel, aynı-origin açık onay gerekli.' }, 403);
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'JSON gerekli.' }, 415);
    const body = parseStrictJsonBytes(await bytes(request, 16 * 1024));
    exactKeys(body, ['confirmation', 'message']);
    if (body.confirmation !== 'publish_close_call') throw new Error('Açık yayın onayı gerekli.');
    const message = body.message as TechnocoreSignedMessage;
    const action = await validateCloseMessage(message);
    const now = (deps.now ?? Date.now)(); assertCloseOpen(now);
    const snapshot = await readCloseSnapshot(message.did, deps);
    if (!snapshot.verified) throw new Error(snapshot.reason);
    if (action.kind === 'owner' && snapshot.registration === 'mint_observed') throw new Error('Tahsis zaten gözlendi; tekrar kayıt gönderilmedi.');
    const sendingAt = (deps.now ?? Date.now)();
    assertCloseOpen(sendingAt);
    if (action.kind !== 'owner') {
      checkTradeWindow(action.terms, snapshot.price, sendingAt);
      if (snapshot.outcomes.some((o) => o.id === action.terms.id && o.status === 'settled')) throw new Error('Bu işlem kimliği zaten sonuçlanmış.');
    }
    const response = await upstream(`/r/${message.room}?format=json`, deps, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ did: message.did, nonce: message.nonce, sig: message.sig, text: message.text }) });
    const proof = await parseTechnocoreAcknowledgement(await bytes(response, 1024 * 1024), message, new Date(now).toISOString());
    return json({ status: 'posted', proof });
  } catch (e) { return json({ error: `${(e as Error).message} Gönderim belirsizse önce kayıtları kontrol edin; otomatik tekrar yok.` }, 400); }
}
