import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { CC, closeDid } from '../lib/close-call';
import { buildDeskReport, classifyRegistration, classifyTrade, deskSummary, parseFlow, verifyDeskReport, type Evidence, type FlowRecord } from '../lib/close-call-desk';
import { records } from '../lib/close-call-service';
import { verifySignedParticipationBundle } from '../lib/participation-bundle';
import { parseTechnocoreAcknowledgement } from '../lib/technocore-records';
import { parseLosslessIntegerJsonBytes, parseStrictJson } from '../lib/strict-json';

const HELP = `Close Call masa aracı. Yalnızca technocore.chat hakem odalarını okur; anahtar, imza veya yazma yok.

  npm run close-call:desk -- reconcile --proof <sunucu-yanıtı.json>
      close1'e gönderilmiş bir owner/trade mesajının hakem kanıtını sınıflandırır.
  npm run close-call:desk -- reconcile --trade <id> --seq <n> --posted-at <iso> --until <tur>
  npm run close-call:desk -- reconcile --owner <did> --seq <n> --posted-at <iso>
  npm run close-call:desk -- report --state <state.json> --keys <keys.json> --operator <did>
      İmzasız masa raporunu stdout'a yazar; operatör bunu kendi anahtarıyla imzalar.
  npm run close-call:desk -- verify <imzalı-rapor.json>
  npm run close-call:desk -- record-proof <imzalı-mesaj.json> <sunucu-yanıtı.json>
      Kendi gönderdiğin mesajdan taşınabilir foundry-technocore-record-proof-v1 üretir.
  npm run close-call:desk -- verify-statement <katkı-beyanı.json>

Sonuçlar: settled/void/listed = hakem listeledi; hidden = uygun turlarda sonuçlar yalnızca sayı olarak
yayımlandı; missed = hakem bu seq aralığını okumadığını yayımladı; absent = listeler eksiksizdi ve
kimlik yok; pending = süre dolmadı. Hiçbiri bakiye kanıtı değildir.`;

async function readBounded(path: string, maximum = 256 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error(`${path}: en fazla ${maximum} bayt normal dosya gerekli.`);
    return await file.readFile({ encoding: 'utf8' });
  } finally { await file.close(); }
}
function flag(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) throw new Error(`${name} gerekli. --help ile kullanımı gör.`);
  return args[i + 1];
}
const deps = { upstreamFetch: fetch };
async function referee(): Promise<{ flows: FlowRecord[]; price: { n: number; ref: string } }> {
  const [flowRecords, priceRecords] = await Promise.all([records('d-close1-flow', deps), records('d-close1-price', deps)]);
  const seed = priceRecords.find((r) => r.value.t === 'seed');
  if (seed?.value.package !== CC.manifest) throw new Error('Başlangıç paketi sabit close-1 manifest hash’i ile eşleşmiyor.');
  const flows = flowRecords.map((r) => parseFlow(r.value, r.proof.ts)).filter((f): f is FlowRecord => f !== null);
  const latest = priceRecords.filter((r) => r.value.t === 'price').at(-1);
  const ref = (latest?.value.ref as Record<string, unknown> | undefined)?.px;
  if (!latest || typeof latest.value.n !== 'number' || typeof ref !== 'string') throw new Error('Hakem fiyat kaydı yok.');
  return { flows, price: { n: latest.value.n, ref } };
}
function describe(e: Evidence) {
  return `${e.status}${e.sweep !== null ? ` (tur ${e.sweep})` : ''}${e.hidden ? ` · gizli sonuç sayısı ${e.hidden}` : ''}${e.reason ? ` · ${e.reason}` : ''}`;
}
/** A technocore.chat acknowledgement ({posted: record}) or a bare room record. */
function fromProof(text: string) {
  // Server responses carry 19-digit nonces; read them losslessly rather than reject the file.
  const value = parseLosslessIntegerJsonBytes(new TextEncoder().encode(text)) as Record<string, unknown>;
  const record = (value.posted ?? value) as Record<string, unknown>;
  if (typeof record.text !== 'string' || typeof record.ts !== 'string' || record.seq === undefined) throw new Error('Kanıt dosyasında seq/ts/text yok.');
  const message = parseStrictJson(record.text) as Record<string, unknown>;
  if (message.season !== CC.season) throw new Error('Bu bir close-1 mesajı değil.');
  const base = { seq: String(record.seq), postedAt: record.ts };
  if (message.t === 'owner') return { kind: 'owner' as const, ...base, did: closeDid(message.key) };
  const terms = message.terms as Record<string, unknown> | undefined;
  if (message.t === 'trade' && typeof terms?.id === 'string' && Number.isSafeInteger(terms.until)) return { kind: 'trade' as const, ...base, id: terms.id, until: terms.until as number };
  throw new Error('Yalnızca owner ve trade mesajları sınıflandırılır.');
}

async function main(args: string[]) {
  const command = args[0];
  if (!command || command === '--help') { console.log(HELP); return; }
  if (command === 'verify') {
    const { envelope, sha256 } = await verifyDeskReport(await readBounded(args[1] ?? ''));
    const r = envelope.report;
    console.log(`Geçerli imza: ${r.operator}\nRapor sha256: ${sha256}\nHakem akış turu ${r.referee.flowSweep}, fiyat ${r.referee.ref}`);
    for (const k of r.keys) console.log(`  ${k.name.padEnd(4)} ${k.did} kayıt: ${k.registration ? describe(k.registration.evidence) : 'yok'}`);
    for (const p of r.pairs) console.log(`  Çift ${p.pair} ${p.long} LONG / ${p.short} SHORT: ${p.status}${p.attempts.map((a) => `\n     ${a.id} ${a.qty} @ ${a.px}: ${describe(a.evidence)}`).join('')}`);
    console.log(`Özet mesajı: ${deskSummary(r, sha256)}`);
    return;
  }
  if (command === 'record-proof') {
    const message = parseStrictJson(await readBounded(args[1] ?? '')) as never;
    const response = new TextEncoder().encode(await readBounded(args[2] ?? '', 1024 * 1024));
    process.stdout.write(`${JSON.stringify(await parseTechnocoreAcknowledgement(response, message))}\n`);
    return;
  }
  if (command === 'verify-statement') {
    if (!(await verifySignedParticipationBundle(parseStrictJson(await readBounded(args[1] ?? ''))))) throw new Error('Katkı beyanı imzası veya şekli geçersiz.');
    console.log('Katkı beyanı geçerli.');
    return;
  }
  if (command === 'reconcile') {
    const { flows } = await referee();
    if (args.includes('--proof')) {
      const proof = fromProof(await readBounded(flag(args, '--proof')));
      const result = proof.kind === 'owner' ? classifyRegistration(flows, proof) : classifyTrade(flows, proof);
      console.log(`${proof.kind === 'owner' ? `Kayıt ${proof.did}` : `İşlem ${proof.id}`} (seq ${proof.seq}): ${describe(result)}`);
      if (args.includes('--json')) console.log(JSON.stringify(result));
      return;
    }
    const seq = flag(args, '--seq'), postedAt = flag(args, '--posted-at');
    if (!/^[0-9]{1,19}$/.test(seq)) throw new Error('--seq sayı olmalı.');
    const result = args.includes('--owner')
      ? classifyRegistration(flows, { did: closeDid(flag(args, '--owner')), seq, postedAt })
      : classifyTrade(flows, { id: flag(args, '--trade'), seq, postedAt, until: Number(flag(args, '--until')) });
    console.log(describe(result));
    if (args.includes('--json')) console.log(JSON.stringify(result));
    return;
  }
  if (command === 'report') {
    const [state, keys] = await Promise.all([readBounded(flag(args, '--state')), readBounded(flag(args, '--keys'))]);
    const { flows, price } = await referee();
    const report = buildDeskReport({ operator: flag(args, '--operator'), createdAt: new Date().toISOString(),
      state: JSON.parse(state), keys: JSON.parse(keys) as Record<string, string>, flows, price });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  throw new Error('Bilinmeyen komut. --help ile kullanımı gör.');
}

main(process.argv.slice(2)).catch((e) => { console.error(`DURDU: ${(e as Error).message}`); process.exitCode = 1; });
