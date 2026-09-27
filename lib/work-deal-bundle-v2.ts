import { canonicalJson, sha256Hex } from './foundry-crypto';
import { decodeStrictUtf8, parseStrictJson } from './strict-json';
import { deriveFoundryJob } from './work-deal-bundle';
import { inspectTclkMultiroom } from './tclk-multiroom';
import { PAPER_RESPONSE_MAX_BYTES, parsePaperHashNote } from './tclk-paper-observer';

export const WORK_DEAL_V2_SCHEMA = 'foundry-work-deal-v2';
export const WORK_DEAL_V2_MAX_BYTES = 12 * 1024 * 1024;
const encode = (s: string) => new TextEncoder().encode(s);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
// Only raw observation fields are carried forward. The collector's verdict is deliberately
// not stored as a trusted input. Anyone can fabricate this unsigned snapshot, even its hash.
export type PaperSnapshot = { contract: string; url: string; observedAt: string; httpStatus: number | null;
  responseText: string | null; responseSha256: string | null };
export function paperSnapshotFromObservation(observation: PaperSnapshot): PaperSnapshot {
  return { contract: observation.contract, url: observation.url, observedAt: observation.observedAt,
    httpStatus: observation.httpStatus, responseText: observation.responseText, responseSha256: observation.responseSha256 };
}
async function inspectSnapshot(value: unknown, deal: Awaited<ReturnType<typeof inspectTclkMultiroom>>) {
  if (value === null) return { state: 'absent', sourceAuthenticity: 'not-proven' };
  check(exact(value, ['contract', 'url', 'observedAt', 'httpStatus', 'responseText', 'responseSha256']), 'Gözlem biçimi geçersiz.');
  const url = `https://technocore.chat/kv/tclk-paper-${deal.contract.slice(2, 4)}/${deal.contract.slice(4, 18)}`;
  check(value.contract === deal.contract && value.url === url, 'Gözlem başka sözleşmeye veya kaynağa ait.');
  check(typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) && new Date(value.observedAt).toISOString() === value.observedAt, 'Gözlem zamanı geçersiz.');
  check(value.httpStatus === null || Number.isInteger(value.httpStatus) && Number(value.httpStatus) >= 100 && Number(value.httpStatus) <= 599, 'HTTP kodu geçersiz.');
  check(value.responseSha256 === null || typeof value.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.responseSha256), 'Gözlem özeti geçersiz.');
  const result = (state: string, mismatches: string[] = []) => ({ state, mismatches,
    sourceAuthenticity: 'not-proven', historicalFunding: 'not-established', settlement: 'no-value-paper-rail' });
  if (value.responseText === null) {
    // Invalid UTF-8 may have a digest but no saved text. It cannot be replayed.
    return result(value.httpStatus === 404 ? 'reported-missing' : 'no-replayable-body');
  }
  check(typeof value.responseText === 'string' && encode(value.responseText).length <= PAPER_RESPONSE_MAX_BYTES, 'Gözlem gövdesi geçersiz veya çok büyük.');
  check(await sha256Hex(encode(value.responseText)) === value.responseSha256, 'Gözlem gövdesi hash ile eşleşmiyor.');
  if (value.httpStatus !== 200) return result('reported-http-error');
  const terms = deal.paperTerms;
  if (!terms || !['paper', 'paperrail', 'paper-rail'].includes(terms.rail.toLowerCase())) return result('not-applicable');
  if (terms.ref !== deal.contract) return result('inconsistent', ['ref']);
  const split = value.responseText.indexOf('\n\n');
  const note = split < 0 ? null : parsePaperHashNote(value.responseText.slice(split + 2).split('\n# budget:', 1)[0].trimEnd());
  if (!note) return result('malformed-body');
  const mismatches = [];
  if (note.statement !== terms.statement) mismatches.push('statement');
  if (note.refundAfterMs !== terms.refundAfterMs) mismatches.push('refundAfterMs');
  if (note.status !== terms.transcriptStatus) mismatches.push('status');
  if (note.secret && `0x${await sha256Hex(Uint8Array.from(note.secret.slice(2).match(/../g)!, (b) => parseInt(b, 16)))}` !== note.statement) mismatches.push('secret');
  return result(mismatches.length ? 'inconsistent' : 'saved-body-consistent', mismatches);
}

async function evaluate(dossier: string, offers: string, agreement: string, contract: string, observation: unknown) {
  const { job, work } = await deriveFoundryJob(encode(dossier));
  const deal = await inspectTclkMultiroom(encode(offers), encode(agreement), contract);
  check(deal.ok, 'İki odalı denetim başarısız; geçerli paket oluşturulamaz.');
  check(canonicalJson(deal.job) === canonicalJson(job), 'Anlaşma job alanı görevle eşleşmiyor.');
  check(deal.payerDid === work.mission.issuerDid && deal.payeeDid === work.mission.claimantDid, 'Görev ve anlaşma tarafları eşleşmiyor.');
  const paper = await inspectSnapshot(observation, deal);
  return { work, deal, paper, binding: { job, dossierSha256: work.sha256,
    contract, sources: deal.sources.map(({ room, sha256 }) => ({ room, sha256 })),
    observationSha256: observation === null ? null : await sha256Hex(encode(canonicalJson(observation))) } };
}
async function report(bytes: Uint8Array, evaluated: Awaited<ReturnType<typeof evaluate>>) {
  const sha256 = await sha256Hex(bytes);
  return { valid: true, schema: WORK_DEAL_V2_SCHEMA, id: `fwd2_${sha256.slice(0, 24)}`, sha256, ...evaluated,
    limits: { container: 'unsigned', observation: 'untrusted-collector-snapshot',
      dossierAttachment: 'local-association-not-counterparty-acknowledgement',
      artifactBytes: 'not-embedded-or-verified', timestampAndSequence: 'unsigned-export-metadata',
      settlement: 'not-proven', eligibility: 'not-established' } };
}
export async function createWorkDealBundleV2(dossierBytes: Uint8Array, offersBytes: Uint8Array, dealBytes: Uint8Array, contract: string, observation: PaperSnapshot | null = null) {
  check(dossierBytes.length + offersBytes.length + dealBytes.length <= WORK_DEAL_V2_MAX_BYTES, 'Kaynak dosyalar çok büyük.');
  const dossier = decodeStrictUtf8(dossierBytes), offers = decodeStrictUtf8(offersBytes), agreement = decodeStrictUtf8(dealBytes);
  const evaluated = await evaluate(dossier, offers, agreement, contract, observation);
  const bytes = encode(canonicalJson({ schema: WORK_DEAL_V2_SCHEMA, dossier, contract,
    transcripts: { offers, agreement }, observation, binding: evaluated.binding }));
  check(bytes.length <= WORK_DEAL_V2_MAX_BYTES, 'Paket 12 MiB sınırını aşıyor.');
  return { bytes, report: await report(bytes, evaluated) };
}
export async function verifyWorkDealBundleV2(bytes: Uint8Array) {
  check(bytes.length > 0 && bytes.length <= WORK_DEAL_V2_MAX_BYTES, 'Paket boyutu geçersiz.');
  const source = decodeStrictUtf8(bytes), value = parseStrictJson(source);
  check(exact(value, ['schema', 'dossier', 'contract', 'transcripts', 'observation', 'binding']) && value.schema === WORK_DEAL_V2_SCHEMA, 'Paket v2 biçimi geçersiz.');
  check(canonicalJson(value) === source, 'Paket kanonik JSON olmalı.');
  check(typeof value.dossier === 'string' && typeof value.contract === 'string' && exact(value.transcripts, ['offers', 'agreement']) && typeof value.transcripts.offers === 'string' && typeof value.transcripts.agreement === 'string', 'Kaynak kayıt biçimi geçersiz.');
  const evaluated = await evaluate(value.dossier, value.transcripts.offers, value.transcripts.agreement, value.contract, value.observation);
  check(canonicalJson(value.binding) === canonicalJson(evaluated.binding), 'Paket bağlantıları kaynaklarla eşleşmiyor.');
  return report(bytes, evaluated);
}
