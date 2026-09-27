import { sha256Hex } from './foundry-crypto';
import { decodeStrictUtf8 } from './strict-json';

export type PaperTerms = { contract: string; lock: 'hash'; statement: string; refundAfterMs: number;
  rail: string; ref: string; transcriptStatus: string };
export const PAPER_RESPONSE_MAX_BYTES = 32 * 1024;
export const PAPER_TIMEOUT_MS = 8000;
export type PaperObservationState = 'matching' | 'missing' | 'request-error' | 'malformed' | 'mismatch' | 'not-applicable';
const hex = /^0x[0-9a-f]{64}$/;

/** Pure, conservative parser for this hash-only observation profile. */
export function parsePaperHashNote(value: string) {
  const parts = value.split(' ');
  if (parts.length < 5 || parts.length > 6) return null;
  const [prefix, status, lock, statement, deadline, secret] = parts;
  if (prefix !== 'tclkpaper1' || !['locked', 'claimed', 'refunded'].includes(status) || lock !== 'hash' || !hex.test(statement)) return null;
  if (!/^[1-9][0-9]*$/.test(deadline) || !Number.isSafeInteger(Number(deadline))) return null;
  if ((status === 'claimed') !== (secret !== undefined) || (secret !== undefined && !hex.test(secret))) return null;
  return { status, lock, statement, refundAfterMs: Number(deadline), secret };
}

/** One explicit read. No user-controlled origin, redirects, credentials, retry or write. */
export async function observePaperRail(terms: PaperTerms, fetcher: typeof fetch = fetch) {
  if (!hex.test(terms.contract) || terms.lock !== 'hash' || !hex.test(terms.statement) ||
    !Number.isSafeInteger(terms.refundAfterMs) || terms.refundAfterMs <= 0 ||
    typeof terms.rail !== 'string' || typeof terms.ref !== 'string' ||
    !['locked', 'claimed', 'refunded'].includes(terms.transcriptStatus)) throw new Error('Doğrulanmış hash-lock anlaşma koşulları gerekli.');
  const url = `https://technocore.chat/kv/tclk-paper-${terms.contract.slice(2, 4)}/${terms.contract.slice(4, 18)}`;
  const observedAt = new Date().toISOString();
  let httpStatus: number | null = null;
  let responseSha256: string | null = null;
  let responseText: string | null = null;
  let noteStatus: string | null = null;
  const finish = (state: PaperObservationState, reason: string, mismatches: string[] = []) => ({
    schema: 'foundry-paper-observation-v1', state, reason, mismatches, contract: terms.contract,
    url, observedAt, httpStatus, responseSha256, responseText, noteStatus,
    trust: { note: 'unsigned-world-writable', observationTime: 'local-clock',
      historicalFunding: 'not-established', settlement: 'no-value-paper-rail',
      sourceAuthenticityOffline: 'not-proven', freshness: 'not-guaranteed' },
  });
  if (!['paper', 'paperrail', 'paper-rail'].includes(terms.rail.toLowerCase())) return finish('not-applicable', 'Bu rail PaperRail değil; ağa istek gönderilmedi.');
  if (terms.ref !== terms.contract) return finish('mismatch', 'PaperRail ref tam sözleşme kimliği değil; ağa istek gönderilmedi.', ['ref']);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAPER_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'text/plain' }, signal: controller.signal });
    } catch { return finish('request-error', controller.signal.aborted ? 'İstek zaman aşımına uğradı.' : 'Ağ isteği tamamlanamadı; kayıt yok sayılamaz.'); }
    httpStatus = response.status;
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return response.status === 404 ? finish('missing', 'Bu istekte HTTP 404 gözlendi; geçmişte hiç kayıt olmadığı anlamına gelmez.')
        : finish('request-error', 'Sunucu başarılı yanıt vermedi; kayıt yok sayılamaz.');
    }
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/plain') {
      await response.body?.cancel().catch(() => undefined);
      return finish('malformed', 'Beklenen text/plain yanıtı alınamadı.');
    }
    const reader = response.body?.getReader();
    if (!reader) return finish('malformed', 'Yanıt gövdesi boş.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > PAPER_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          return finish('malformed', 'Yanıt 32 KiB sınırını aşıyor.');
        }
        chunks.push(value);
      }
    } catch { return finish('request-error', 'Yanıt tam okunamadı; kayıt yok sayılamaz.'); }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    responseSha256 = await sha256Hex(bytes);
    try { responseText = decodeStrictUtf8(bytes); } catch { return finish('malformed', 'Yanıt geçerli UTF-8 değil.'); }
    // Technocore text note envelope: metadata, blank line, value, optional budget footer.
    const split = responseText.indexOf('\n\n');
    if (split < 0) return finish('malformed', 'Not yanıtının zarfı eksik.');
    const value = responseText.slice(split + 2).split('\n# budget:', 1)[0].trimEnd();
    const record = parsePaperHashNote(value);
    if (!record) return finish('malformed', 'PaperRail notu bu hash-lock profilinde çözümlenemedi.');
    noteStatus = record.status;
    const mismatches: string[] = [];
    if (record.statement !== terms.statement) mismatches.push('statement');
    if (record.refundAfterMs !== terms.refundAfterMs) mismatches.push('refundAfterMs');
    if (record.status !== terms.transcriptStatus) mismatches.push('status');
    if (record.secret && `0x${await sha256Hex(Uint8Array.from(record.secret.slice(2).match(/../g)!, (b) => parseInt(b, 16)))}` !== record.statement) mismatches.push('secret');
    return mismatches.length ? finish('mismatch', 'Okunan not ile anlaşma koşulları veya tanık uyuşmuyor.', mismatches)
      : finish('matching', 'Okunan deneme notu koşullarla tutarlı; gerçek ödeme veya geçmiş kilit kanıtı değildir.');
  } finally { clearTimeout(timer); }
}
