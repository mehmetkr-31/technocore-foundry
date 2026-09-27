import { parseStrictJson } from './strict-json';
import { verifyTechnocoreExport, type TechnocoreRecordVerification } from './technocore-records';
import { inspectTclkTranscript } from './browser-tclk-inspector.mjs';

export const MULTIROOM_MAX_BYTES = 2 * 1024 * 1024;
export const MULTIROOM_PROFILE = 'foundry-tclk-multiroom-v1';
type Frame = { type: string; id?: string; ref?: string; contract?: string; from: string;
  expiresMs?: number; refundAfterMs?: number; lock?: string; statement?: string; rail?: string; role?: string };
type Row = { room: string; record: TechnocoreRecordVerification; frame: Frame };
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Strict selected-contract audit, not a live watcher or settlement verifier.
 * Both files remain in append order. They are never globally sorted by unsigned time.
 * Invalid selected records fail the audit; unrelated board noise is counted separately.
 */
export async function inspectTclkMultiroom(offersBytes: Uint8Array, dealBytes: Uint8Array, contract: string) {
  requireValue(/^0x[0-9a-f]{64}$/.test(contract), 'Tam sözleşme kimliği gerekli.');
  for (const bytes of [offersBytes, dealBytes]) requireValue(bytes.length <= MULTIROOM_MAX_BYTES, 'Her oda dosyası en fazla 2 MiB olabilir.');
  const dealRoom = `mb-p-tclk-${contract.slice(2, 18)}`;
  const board = await verifyTechnocoreExport(offersBytes, 'tclk-offers');
  const deal = await verifyTechnocoreExport(dealBytes, dealRoom);
  let unparsedTclkRecords = 0;
  const rows: Row[] = [];
  for (const source of [board, deal]) for (const record of source.records) {
    if (!record.text.startsWith('tclk1 ')) continue;
    try {
      const frame = parseStrictJson(record.text.slice(6));
      if (frame && typeof frame === 'object' && !Array.isArray(frame)) rows.push({ room: source.room, record, frame: frame as Frame });
      else unparsedTclkRecords++;
    } catch { unparsedTclkRecords++; }
  }
  const accepts = rows.filter((r) => r.frame.type === 'accept' && r.frame.contract === contract);
  requireValue(accepts.length === 1, 'Tek bir kabul kaydı gerekli; eksik veya yinelenmiş kabul.');
  const accept = accepts[0];
  const offers = rows.filter((r) => r.frame.type === 'offer' && r.frame.id === accept.frame.ref);
  requireValue(offers.length === 1, 'Tek bir bağlı teklif gerekli; eksik veya yinelenmiş teklif.');
  const offer = offers[0];
  requireValue(offer.room === 'tclk-offers' && accept.room === 'tclk-offers', 'Teklif ve kabul tclk-offers odasında olmalı.');
  requireValue(offer.record.line < accept.record.line, 'Kabul tekliften önce olamaz.');
  const later = rows.filter((r) => r !== accept && r.frame.contract === contract);
  requireValue(later.every((r) => r.room === dealRoom), 'Kabul sonrası kayıt yanlış odada.');
  const selected = [offer, accept, ...later];
  requireValue(selected.every((r) => r.record.signatureState === 'valid' && r.record.from === r.frame.from), 'Seçilen kayıtta geçersiz imza veya farklı yazar DID var.');
  requireValue(offer.frame.lock === 'hash', 'Bu denetim profili yalnızca hash kilidini destekler.');
  const structural = await inspectTclkTranscript(new TextEncoder().encode(selected.map((r) => r.record.text).join('\n')));
  requireValue(structural.contract === contract, 'Sözleşme bağlantısı doğrulanamadı.');
  const timingErrors: Array<{ room: string; seq: string; reason: string }> = [];
  let previousTime = -1;
  for (const { room, record, frame } of selected) {
    const time = Date.parse(record.ts);
    let reason = '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(record.ts) || !Number.isFinite(time) || time < 0) reason = 'Geçersiz UTC zaman damgası';
    else if (time < previousTime) reason = 'Seçilen kayıtlarda zaman geriye gidiyor';
    else if (frame.type === 'accept' && time >= offer.frame.expiresMs!) reason = 'Teklif kabul sırasında sona ermiş';
    else if (['lock', 'reveal'].includes(frame.type) && time >= offer.frame.refundAfterMs!) reason = 'İade süresi başlamış';
    else if (frame.type === 'refund' && time < offer.frame.refundAfterMs!) reason = 'İade süresi henüz başlamamış';
    if (reason) timingErrors.push({ room, seq: record.seq, reason });
    previousTime = time;
  }
  const ok = structural.ok && timingErrors.length === 0;
  const lockFrame = later.find((r) => r.frame.type === 'lock')?.frame;
  return {
    schema: MULTIROOM_PROFILE, ok, contract,
    job: structural.offer.job ?? null,
    payerDid: offer.frame.role === 'payer' ? offer.record.from : accept.record.from,
    payeeDid: offer.frame.role === 'payee' ? offer.record.from : accept.record.from,
    verifiedStatus: ok ? structural.status : null,
    structuralStatus: structural.status,
    terminal: ok && ['claimed', 'refunded', 'cancelled'].includes(structural.status),
    paperTerms: ok && lockFrame ? { contract, lock: 'hash' as const, statement: accept.frame.statement!,
      refundAfterMs: offer.frame.refundAfterMs!, rail: lockFrame.rail!, ref: lockFrame.ref!,
      transcriptStatus: structural.status } : null,
    sources: [board, deal].map((s) => ({ room: s.room, sha256: s.sha256, bytes: s.bytes, records: s.records.length, signatureCounts: s.counts })),
    selectedRecords: selected.map((r) => ({ room: r.room, seq: r.record.seq, ts: r.record.ts, did: r.record.from, type: r.frame.type, lineSha256: r.record.lineSha256 })),
    ignoredRecords: board.records.length + deal.records.length - selected.length,
    unparsedTclkRecords,
    structuralEvents: structural.events, timingErrors,
    layers: { signatures: 'valid', protocolRooms: 'valid',
      frameOrder: structural.layers.frameOrder,
      deadlines: timingErrors.length ? 'invalid' : 'consistent-with-unsigned-export-time',
      terminalReceipt: structural.layers.terminalReceipt,
      settlement: 'not-checked', workQuality: 'not-checked', inclusion: 'not-proven', completeness: 'not-proven' },
    caveats: ['Zaman ve sıra numarası sunucunun imzasız beyanıdır.',
      'İki oda dosyası append sırasını korur; zamanla yeniden sıralanmaz.',
      'Eksik geçmiş veya sonradan değiştirilmiş sunucu metadata bilgileri imzadan anlaşılamaz.',
      'PaperRail okunmadı; durum veya makbuz, ödeme ya da iş kalitesi kanıtı değildir.',
      'Hash-only strict profil: seçilen kayıtlardaki tekrarlar ve geriye giden zaman reddedilir; tüm upstream özellikleri desteklenmez.'],
  };
}
