import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { inspectTclkMultiroom, MULTIROOM_MAX_BYTES } from '../lib/tclk-multiroom';
import { observePaperRail } from '../lib/tclk-paper-observer';

async function boundedRead(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MULTIROOM_MAX_BYTES) throw new Error('En fazla 2 MiB büyüklüğünde normal JSONL dosyası gerekli.');
    const buffer = Buffer.alloc(MULTIROOM_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MULTIROOM_MAX_BYTES) throw new Error('Dosya boyut sınırını aşıyor.');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

const args = process.argv.slice(2);
const paperRequested = args.length === 4 && args[3] === '--paper';
if (args.length === 1 && args[0] === '--help') {
  console.log('npm run deal:audit -- offers.jsonl deal.jsonl 0x<64-hex-contract> [--paper]\nVarsayılan çevrimdışı. --paper: doğrulama sonrası yalnızca technocore.chat üzerinde bir not okur. Anahtar, ağ yazımı veya ödeme yok.');
} else if (args.length !== 3 && !paperRequested) {
  console.error('İki JSONL dosyası ve tam sözleşme kimliği gerekli. --help ile kullanımı gör.');
  process.exitCode = 2;
} else {
  try {
    const [offers, deal] = await Promise.all(args.slice(0, 2).map(boundedRead));
    const report = await inspectTclkMultiroom(offers, deal, args[2]);
    let paperObservation = null;
    if (paperRequested && report.ok && report.paperTerms) {
      console.error('PaperRail: technocore.chat üzerinden salt okunur gözlem. Not imzasızdır; gerçek para hareketi yoktur.');
      paperObservation = await observePaperRail(report.paperTerms);
    }
    console.log(JSON.stringify({ ...report, paperObservation,
      paperObservationSkipped: paperRequested && !paperObservation ? 'Geçerli, kilit içeren bir anlaşma gerekli; ağ isteği yapılmadı.' : null }, null, 2));
    process.exitCode = report.ok && (!paperRequested || paperObservation?.state === 'matching') ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Denetim başarısız.' }));
    process.exitCode = 1;
  }
}
