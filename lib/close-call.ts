/** Close Call v0.1: independent, bounded adapter for the frozen close-1 package. */
import { base64UrlToBytes, bytesToBase64Url, canonicalJson, didFromPublicKey, isCanonicalTechnocoreSignature,
  nextTechnocoreNonce, publicKeyFromDid, unlockVault, verifyTechnocoreMessage,
  type FoundryVault, type TechnocoreSignedMessage } from './foundry-crypto';
import { parseStrictJson } from './strict-json';

export const CC = Object.freeze({
  season: 'close-1', room: 'close1', offersRoom: 'close1-offers', mint: '10000',
  opening: Date.parse('2026-09-25T12:00:00Z'), lock: Date.parse('2026-10-04T09:00:00Z'),
  final: Date.parse('2026-10-04T10:00:00Z'), lockSweep: 2556,
  referee: 'did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte',
  manifest: 'bae09812e25eb6f1369c611f24964f7ea0acafddfc45301a16f33f941296dafa',
});
export const CC_REFEREE_ROOMS = ['d-close1-price', 'd-close1-flow', 'd-close1-state', 'd-close1-positions', 'd-close1-pnl'] as const;
export type CloseTerms = { id: string; maker: string; px: string; qty: string; side: 'buy' | 'sell'; taker: string; until: number };
export type CloseOffer = { t: 'close-call.offer.v1'; season: 'close-1'; terms: CloseTerms; maker_sig: string };
export type CloseTrade = { t: 'trade'; season: 'close-1'; terms: CloseTerms; taker: string; maker_sig: string; taker_sig: string };
export type ClosePrice = { n: number; ref: string; limits: [string, string]; postedAt: string };
export type CloseSnapshot = {
  verified: boolean; reason: string; checkedAt: string; price: ClosePrice | null;
  registration: 'mint_observed' | 'unknown'; mintEvidence: unknown | null;
  offers: CloseOffer[]; outcomes: { id: string; status: 'settled' | 'void'; reason: string; sweep: number }[];
  leaderboard: unknown[]; warnings: string[]; evidence: unknown[];
};

export function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('Beklenmeyen alanlar veya veri biçimi.');
}
export function closeDid(value: unknown): string {
  if (typeof value !== 'string' || didFromPublicKey(publicKeyFromDid(value)) !== value) throw new Error('Geçerli Ed25519 DID gerekli.');
  return value;
}
// Integer fixed-point throughout: never parse amounts with binary floats.
export function cents(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(value)) throw new Error('Fiyat/miktar en fazla iki ondalıklı pozitif metin olmalı.');
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (n <= 0n) throw new Error('Fiyat/miktar sıfırdan büyük olmalı.');
  return n;
}
export function makeTerms(value: CloseTerms): CloseTerms {
  exactKeys(value, ['id', 'maker', 'px', 'qty', 'side', 'taker', 'until']);
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) throw new Error('Geçersiz işlem kimliği.');
  closeDid(value.maker); if (value.taker !== 'any') closeDid(value.taker);
  cents(value.px); if (cents(value.qty) < 10n) throw new Error('En az 0.10 NVDA gerekli.');
  if (value.side !== 'buy' && value.side !== 'sell') throw new Error('Yön buy veya sell olmalı.');
  if (!Number.isSafeInteger(value.until) || value.until < 1 || value.until > CC.lockSweep) throw new Error('Geçersiz son tur.');
  return { id: value.id, maker: value.maker, px: value.px, qty: value.qty, side: value.side, taker: value.taker, until: value.until };
}
export function makerPayload(terms: CloseTerms) { return `${CC.season}|terms|${canonicalJson(makeTerms(terms))}`; }
export function takerPayload(terms: CloseTerms, did: string) { return `${CC.season}|accept|${canonicalJson(makeTerms(terms))}|${closeDid(did)}`; }
export async function verifyCloseSignature(did: string, payload: string, signature: string) {
  try {
    if (!isCanonicalTechnocoreSignature(signature)) return false;
    const key = await crypto.subtle.importKey('raw', publicKeyFromDid(closeDid(did)), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', key, base64UrlToBytes(signature), new TextEncoder().encode(payload));
  } catch { return false; }
}
export async function parseOffer(text: string): Promise<CloseOffer> {
  if (text.length > 8192) throw new Error('Teklif dosyası çok büyük.');
  const value = parseStrictJson(text);
  exactKeys(value, ['t', 'season', 'terms', 'maker_sig']);
  if (value.t !== 'close-call.offer.v1' || value.season !== CC.season) throw new Error('Bu bir close-1 teklifi değil.');
  const terms = makeTerms(value.terms as CloseTerms);
  if (typeof value.maker_sig !== 'string' || !(await verifyCloseSignature(terms.maker, makerPayload(terms), value.maker_sig))) throw new Error('Teklif sahibinin imzası geçersiz.');
  return { t: 'close-call.offer.v1', season: 'close-1', terms, maker_sig: value.maker_sig };
}
export function assertCloseOpen(now = Date.now()) {
  if (now < CC.opening || now >= CC.lock) throw new Error('Yarışma kayıt/işlem aralığı dışında.');
}
export function checkTradeWindow(terms: CloseTerms, price: ClosePrice | null, now = Date.now()) {
  makeTerms(terms); assertCloseOpen(now);
  if (!price || !Number.isSafeInteger(price.n) || price.n < 1 || price.n >= CC.lockSweep) throw new Error('Güncel hakem fiyatı gerekli.');
  const timestamp = Date.parse(price.postedAt);
  // A freshly replayed old sweep cannot keep trading enabled: check sweep time as well.
  const sweepTime = CC.opening + price.n * 300_000;
  if (!Number.isFinite(timestamp) || now - timestamp > 900_000 || timestamp > now + 60_000 || now - sweepTime > 900_000 || sweepTime > now + 60_000) throw new Error('Hakem verisi bayat; imzalama kapalı.');
  if (terms.until < price.n + 1) throw new Error('Teklifin geçerlilik süresi dolmuş.');
  const px = cents(terms.px);
  if (px < cents(price.limits[0]) || px > cents(price.limits[1])) throw new Error('Fiyat güncel hakem sınırları dışında.');
}
function fixed(value: bigint, places: number) {
  const scale = 10n ** BigInt(places);
  return `${value / scale}.${(value % scale).toString().padStart(places, '0')}`.replace(/0+$/, '').replace(/\.$/, '');
}
export function tradePreview(terms: CloseTerms, taker: boolean, closeEstimate: string) {
  makeTerms(terms);
  const side = taker ? (terms.side === 'buy' ? 'sell' : 'buy') : terms.side;
  const px = cents(terms.px), qty = cents(terms.qty), close = cents(closeEstimate);
  const notional = px * qty, base = notional; // base fee / 1e6, value / 1e4
  const advantage = (side === 'buy' ? close - px : px - close) * qty * 100n;
  return { side, notional: fixed(notional, 4), baseFee: fixed(base, 6),
    estimatedFee: fixed(advantage > base ? advantage : base, 6), collateral: fixed(notional, 4) };
}
export async function validateCloseMessage(message: TechnocoreSignedMessage) {
  exactKeys(message, ['room', 'did', 'sig', 'nonce', 'text']);
  if ((message.room !== CC.room && message.room !== CC.offersRoom) || typeof message.text !== 'string' || message.text.length > 4096 || !(await verifyTechnocoreMessage(message))) throw new Error('Dış oda imzası geçersiz.');
  const value = parseStrictJson(message.text) as Record<string, unknown>;
  if (value?.season !== CC.season) throw new Error('Yanlış yarışma.');
  if (value.t === 'owner') {
    exactKeys(value, ['t', 'season', 'key']);
    if (message.room !== CC.room || value.key !== message.did) throw new Error('Kayıt kendi DID’iniz için olmalı.');
    return { kind: 'owner' as const };
  }
  if (value.t === 'close-call.offer.v1') {
    const offer = await parseOffer(message.text);
    if (message.room !== CC.offersRoom || offer.terms.maker !== message.did) throw new Error('Teklif sahibi/imza odası uyuşmuyor.');
    return { kind: 'offer' as const, terms: offer.terms };
  }
  if (value.t === 'trade') {
    exactKeys(value, ['t', 'season', 'terms', 'taker', 'maker_sig', 'taker_sig']);
    const terms = makeTerms(value.terms as CloseTerms);
    const taker = closeDid(value.taker);
    if (message.room !== CC.room || message.did !== taker || taker === terms.maker || (terms.taker !== 'any' && terms.taker !== taker)) throw new Error('Kendi teklifiniz veya başka DID’e ayrılmış teklif kabul edilemez.');
    if (typeof value.maker_sig !== 'string' || typeof value.taker_sig !== 'string' ||
      !(await verifyCloseSignature(terms.maker, makerPayload(terms), value.maker_sig)) ||
      !(await verifyCloseSignature(taker, takerPayload(terms, taker), value.taker_sig))) throw new Error('Çift taraflı işlem imzası geçersiz.');
    return { kind: 'accept' as const, terms };
  }
  throw new Error('Bu araç yalnızca owner, teklif ve çift imzalı trade yayımlar.');
}
export type CloseAction = { kind: 'owner' } | { kind: 'offer'; terms: CloseTerms } | { kind: 'accept'; offer: CloseOffer };
export async function signCloseAction(vault: FoundryVault, pass: string, action: CloseAction, minimumNonce?: string): Promise<TechnocoreSignedMessage> {
  assertCloseOpen();
  let record: unknown, room: string = CC.room;
  // Validate before asking WebCrypto to decrypt the vault.
  if (action.kind === 'offer') {
    makeTerms(action.terms);
    if (action.terms.maker !== vault.did) throw new Error('Teklif sahibi seçili DID değil.');
  } else if (action.kind === 'accept') {
    await parseOffer(JSON.stringify(action.offer));
    if (action.offer.terms.maker === vault.did || !['any', vault.did].includes(action.offer.terms.taker)) throw new Error('Bu teklif bu DID ile kabul edilemez.');
  } else if (action.kind !== 'owner') throw new Error('Bilinmeyen işlem.');
  const key = await unlockVault(vault, pass);
  const sign = async (text: string) => bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text))));
  if (action.kind === 'owner') record = { t: 'owner', season: CC.season, key: vault.did };
  else if (action.kind === 'offer') {
    room = CC.offersRoom;
    record = { t: 'close-call.offer.v1', season: CC.season, terms: makeTerms(action.terms), maker_sig: await sign(makerPayload(action.terms)) };
  } else record = { t: 'trade', season: CC.season, terms: action.offer.terms, taker: vault.did,
    maker_sig: action.offer.maker_sig, taker_sig: await sign(takerPayload(action.offer.terms, vault.did)) };
  const text = JSON.stringify(record), nonce = nextTechnocoreNonce(minimumNonce);
  const message = { room, did: vault.did, text, nonce, sig: await sign(`${room}|${nonce}|${text}`) };
  await validateCloseMessage(message);
  return message;
}
