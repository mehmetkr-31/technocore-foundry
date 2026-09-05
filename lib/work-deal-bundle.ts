import { canonicalJson, sha256Hex } from './foundry-crypto';
import { decodeStrictUtf8, parseStrictJson } from './strict-json';
import { verifyDossierInBrowser, BROWSER_DOSSIER_MAX_BYTES } from './browser-dossier-verifier.mjs';
import { inspectTclkTranscript, inspectTclkTechnocoreExport } from './browser-tclk-inspector.mjs';

export const WORK_DEAL_SCHEMA = 'foundry-work-deal-v1';
export const WORK_DEAL_MAX_BYTES = 4 * 1024 * 1024;
export const WORK_DEAL_TRANSCRIPT_MAX_BYTES = 256 * 1024;
const encoder = new TextEncoder();
export type WorkDealFormat = 'raw' | 'technocore-jsonl';
type Transcript = { format: WorkDealFormat; room: string | null; text: string };
type Frame = { type: string; from: string; role?: string };

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}

function bounded(bytes: Uint8Array, maximum: number, label: string) {
  requireCondition(bytes.byteLength > 0 && bytes.byteLength <= maximum, `${label}: dosya boyutu sınırı aşıldı veya dosya boş.`);
  return decodeStrictUtf8(bytes);
}

export async function deriveFoundryJob(bytes: Uint8Array) {
  const text = bounded(bytes, BROWSER_DOSSIER_MAX_BYTES, 'Dossier');
  const work = await verifyDossierInBrowser(bytes);
  const dossier = parseStrictJson(text) as { mission: { receiptId: string }; receipts: Array<{ id: string; kind: string; canonicalSha256: string }> };
  const receipt = dossier.receipts.find((entry) => entry.id === dossier.mission.receiptId && entry.kind === 'mission');
  requireCondition(receipt, 'İmzalı görev kaydı bulunamadı.');
  return {
    job: { proto: 'foundry-mission-v1', id: work.mission.id, context: receipt.canonicalSha256 },
    work,
  };
}

async function evaluate(dossierText: string, transcript: Transcript) {
  const { job, work } = await deriveFoundryJob(encoder.encode(dossierText));
  const transcriptBytes = encoder.encode(transcript.text);
  bounded(transcriptBytes, WORK_DEAL_TRANSCRIPT_MAX_BYTES, 'TCLK');
  const deal = transcript.format === 'raw'
    ? await inspectTclkTranscript(transcriptBytes)
    : await inspectTclkTechnocoreExport(transcriptBytes, transcript.room!);
  requireCondition(deal.ok && deal.invalidCount === 0 && deal.contract, 'Geçerli, kabul edilmiş tek bir TCLK anlaşması gerekli.');
  if (transcript.format === 'technocore-jsonl') {
    requireCondition(deal.layers.transportDid === 'valid', 'TCLK mesajlarının dış imzaları taraflarla eşleşmiyor.');
  }
  requireCondition(canonicalJson(deal.offer.job ?? null) === canonicalJson(job), 'TCLK job alanı bu görevin kimliği ve imzalı görev özetiyle eşleşmiyor.');
  const lines = deal.transport
    ? deal.transport.records.map((entry) => entry.text)
    : transcript.text.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line).filter(Boolean);
  const frames = lines.map((line) => parseStrictJson(line.slice('tclk1 '.length)) as Frame);
  const offer = frames[0];
  const acceptIndex = frames.findIndex((frame) => frame.type === 'accept');
  requireCondition(acceptIndex >= 0, 'Kabul kaydı bulunamadı.');
  const payer = offer.role === 'payer' ? offer.from : frames[acceptIndex].from;
  const payee = offer.role === 'payee' ? offer.from : frames[acceptIndex].from;
  requireCondition(payer === work.mission.issuerDid && payee === work.mission.claimantDid,
    'Anlaşmadaki ödeyen görev sahibiyle, işi yapan da görevi üstlenen DID ile eşleşmeli.');
  const terminalFrames = await Promise.all(frames.flatMap((frame, index) =>
    ['reveal', 'refund', 'cancel', 'receipt'].includes(frame.type)
      ? [sha256Hex(encoder.encode(lines[index])).then((sha256) => ({ index, type: frame.type, sha256 }))] : []));
  const binding = {
    job,
    dossierSha256: work.sha256,
    contractId: deal.contract,
    // Exact validated ASCII wire frames, joined by one LF without a trailing LF.
    contractFramesSha256: await sha256Hex(encoder.encode(`${lines[0]}\n${lines[acceptIndex]}`)),
    transcriptSha256: await sha256Hex(transcriptBytes),
    payerDid: payer,
    payeeDid: payee,
    terminalFrames,
  };
  return { binding, work, deal };
}

function parseTranscript(value: unknown): Transcript {
  requireCondition(exactKeys(value, ['format', 'room', 'text']), 'TCLK kaynak alanları geçersiz.');
  requireCondition(value.format === 'raw' || value.format === 'technocore-jsonl', 'TCLK kaynak biçimi geçersiz.');
  requireCondition(typeof value.text === 'string', 'TCLK metni gerekli.');
  requireCondition(value.format === 'raw' ? value.room === null : typeof value.room === 'string' && value.room.length > 0, 'JSONL için kaynak oda adı gerekli; ham kayıtta oda iddiası olamaz.');
  return value as unknown as Transcript;
}

export async function createWorkDealBundle(dossierBytes: Uint8Array, transcriptBytes: Uint8Array, format: WorkDealFormat, room?: string) {
  const dossier = bounded(dossierBytes, BROWSER_DOSSIER_MAX_BYTES, 'Dossier');
  const transcript = parseTranscript({ format, room: format === 'raw' ? null : room, text: bounded(transcriptBytes, WORK_DEAL_TRANSCRIPT_MAX_BYTES, 'TCLK') });
  const evaluated = await evaluate(dossier, transcript);
  const bytes = encoder.encode(canonicalJson({ schema: WORK_DEAL_SCHEMA, dossier, transcript, binding: evaluated.binding }));
  requireCondition(bytes.length <= WORK_DEAL_MAX_BYTES, 'Birleşik paket 4 MiB sınırını aşıyor.');
  return { bytes, report: await reportFor(bytes, evaluated) };
}

async function reportFor(bytes: Uint8Array, evaluated: Awaited<ReturnType<typeof evaluate>>) {
  const sha256 = await sha256Hex(bytes);
  return {
    valid: true as const,
    id: `fwd_${sha256.slice(0, 24)}`,
    sha256,
    ...evaluated,
    limits: {
      bundleSignature: 'unsigned-container' as const,
      dossierAttachment: 'local-association-not-counterparty-acknowledgement' as const,
      artifactBytes: 'not-embedded-or-verified' as const,
      settlement: 'not-checked' as const,
      deadlines: 'not-checked' as const,
    },
  };
}

export type WorkDealReport = Awaited<ReturnType<typeof reportFor>>;

export async function verifyWorkDealBundle(bytes: Uint8Array): Promise<WorkDealReport> {
  const source = bounded(bytes, WORK_DEAL_MAX_BYTES, 'Birleşik paket');
  const value = parseStrictJson(source);
  requireCondition(exactKeys(value, ['schema', 'dossier', 'transcript', 'binding']) && value.schema === WORK_DEAL_SCHEMA && typeof value.dossier === 'string', 'Birleşik paket biçimi geçersiz.');
  requireCondition(canonicalJson(value) === source, 'Paket kanonik JSON biçiminde olmalı; içeriği yeniden biçimlendirme.');
  const evaluated = await evaluate(value.dossier, parseTranscript(value.transcript));
  requireCondition(canonicalJson(value.binding) === canonicalJson(evaluated.binding), 'Paket bağlantıları kaynak kanıtlarla eşleşmiyor.');
  return reportFor(bytes, evaluated);
}
