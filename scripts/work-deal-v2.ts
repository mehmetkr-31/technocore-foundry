import { open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseStrictJson, decodeStrictUtf8 } from '../lib/strict-json';
import { createWorkDealBundleV2, verifyWorkDealBundleV2, WORK_DEAL_V2_MAX_BYTES,
  paperSnapshotFromObservation, type PaperSnapshot } from '../lib/work-deal-bundle-v2';
import { verifyWorkDealBundle, WORK_DEAL_SCHEMA } from '../lib/work-deal-bundle';

async function read(path: string, max = WORK_DEAL_V2_MAX_BYTES) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > max) throw new Error('Dosya normal bir dosya olmalı ve boyut sınırını aşmamalı.');
    const buffer = Buffer.alloc(max + 1); let length = 0;
    while (length < buffer.length) {
      const part = await file.read(buffer, length, buffer.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > max) throw new Error('Dosya çok büyük.');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}
const args = process.argv.slice(2);
try {
  if (args[0] === 'create' && [6, 7].includes(args.length)) {
    const [dossier, offers, agreement] = await Promise.all([read(args[1], 512 * 1024), read(args[2], 2 * 1024 * 1024), read(args[3], 2 * 1024 * 1024)]);
    let snapshot: PaperSnapshot | null = null;
    if (args[6]) {
      const saved = parseStrictJson(decodeStrictUtf8(await read(args[6], 512 * 1024))) as { paperObservation?: PaperSnapshot };
      if (!saved || !saved.paperObservation) throw new Error('Gözlem dosyasında paperObservation gerekli.');
      snapshot = paperSnapshotFromObservation(saved.paperObservation);
    }
    const result = await createWorkDealBundleV2(dossier, offers, agreement, args[4], snapshot);
    await writeFile(args[5], result.bytes, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ saved: args[5], id: result.report.id, sha256: result.report.sha256,
      paper: result.report.paper, limits: result.report.limits }, null, 2));
  } else if (args[0] === 'verify' && args.length === 2) {
    const bytes = await read(args[1]);
    const value = parseStrictJson(decodeStrictUtf8(bytes)) as { schema?: string };
    const result = value?.schema === WORK_DEAL_SCHEMA ? await verifyWorkDealBundle(bytes) : await verifyWorkDealBundleV2(bytes);
    console.log(JSON.stringify({ valid: result.valid, id: result.id, sha256: result.sha256, limits: result.limits,
      ...('paper' in result ? { paper: result.paper, dealStatus: result.deal.verifiedStatus } : {}) }, null, 2));
  } else {
    console.log('npm run deal:bundle -- create dossier.json offers.jsonl deal.jsonl 0x<contract> output.json [audit-report.json]\nnpm run deal:bundle -- verify package.json\nTamamen çevrimdışı. Çıktı dosyasının üzerine yazılmaz. Gözlem imzalı ödeme kanıtı değildir.');
    if (args[0] !== '--help') process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({ valid: false, error: error instanceof Error ? error.message : 'Paket işlemi başarısız.' }));
  process.exitCode = 1;
}
