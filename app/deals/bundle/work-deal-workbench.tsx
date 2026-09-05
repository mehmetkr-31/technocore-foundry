'use client';

import { useRef, useState } from 'react';
import { demoData } from './demo-data';
import { BROWSER_DOSSIER_MAX_BYTES } from '@/lib/browser-dossier-verifier.mjs';
import { createInspectorRunGate } from '@/lib/inspector-run-gate';
import {
  createWorkDealBundle, deriveFoundryJob, verifyWorkDealBundle,
  WORK_DEAL_MAX_BYTES, WORK_DEAL_TRANSCRIPT_MAX_BYTES,
  type WorkDealFormat, type WorkDealReport,
} from '@/lib/work-deal-bundle';

type Files = { dossier?: Uint8Array; transcript?: Uint8Array; bundle?: Uint8Array };

export default function WorkDealWorkbench() {
  const [files, setFiles] = useState<Files>({});
  const [format, setFormat] = useState<WorkDealFormat>('raw');
  const [room, setRoom] = useState('');
  const [job, setJob] = useState('');
  const [report, setReport] = useState<WorkDealReport>();
  const [download, setDownload] = useState<Uint8Array>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createInspectorRunGate());

  function clearResult() {
    gate.current.cancel(); setReport(undefined); setDownload(undefined); setError('');
  }

  async function readFile(file: File | undefined, kind: keyof Files) {
    clearResult();
    setFiles((current) => ({ ...current, [kind]: undefined }));
    if (kind === 'dossier') setJob('');
    if (!file) return;
    const token = gate.current.begin(); setBusy(true);
    try {
      const max = kind === 'dossier' ? BROWSER_DOSSIER_MAX_BYTES : kind === 'transcript' ? WORK_DEAL_TRANSCRIPT_MAX_BYTES : WORK_DEAL_MAX_BYTES;
      if (!file.size || file.size > max) throw new Error(`Dosya boş veya ${max / 1024} KiB sınırını aşıyor.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const derived = kind === 'dossier' ? await deriveFoundryJob(bytes) : undefined;
      if (!gate.current.isCurrent(token)) return;
      setFiles((current) => ({ ...current, [kind]: bytes }));
      if (derived) setJob(JSON.stringify(derived.job, null, 2));
    } catch (cause) {
      if (gate.current.isCurrent(token)) setError(cause instanceof Error ? cause.message : 'Dosya okunamadı.');
    } finally { if (gate.current.isCurrent(token)) setBusy(false); }
  }

  async function run(mode: 'create' | 'verify') {
    clearResult(); const token = gate.current.begin(); setBusy(true);
    try {
      if (mode === 'create') {
        if (!files.dossier || !files.transcript) throw new Error('Görev dosyası ve TCLK kaydı gerekli.');
        const result = await createWorkDealBundle(files.dossier, files.transcript, format, room);
        if (gate.current.isCurrent(token)) { setReport(result.report); setDownload(result.bytes); }
      } else {
        if (!files.bundle) throw new Error('Birleşik paket seç.');
        const result = await verifyWorkDealBundle(files.bundle);
        if (gate.current.isCurrent(token)) setReport(result);
      }
    } catch (cause) {
      if (gate.current.isCurrent(token)) setError(cause instanceof Error ? cause.message : 'Doğrulama tamamlanamadı.');
    } finally { if (gate.current.isCurrent(token)) setBusy(false); }
  }

  function save() {
    if (!download || !report) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(download)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${report.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function tryDemo() {
    clearResult(); const token = gate.current.begin(); setBusy(true);
    try {
      const bytes = new TextEncoder().encode(demoData.bundle);
      const result = await verifyWorkDealBundle(bytes);
      if (gate.current.isCurrent(token)) { setReport(result); setDownload(bytes); }
    } catch (cause) {
      if (gate.current.isCurrent(token)) setError(cause instanceof Error ? cause.message : 'Demo doğrulanamadı.');
    } finally { if (gate.current.isCurrent(token)) setBusy(false); }
  }

  return <section className="readiness-workflow" lang="tr">
    <article className="readiness-panel">
      <h2>İlk kez mi kullanıyorsun?</h2>
      <p>Demo, örnek bir tamamlanmış işi iptal edilmiş bir deneme anlaşmasıyla birlikte doğrular. Gerçek katkı, ödeme veya airdrop kanıtı değildir. Kasa dosyana ve parolana ihtiyaç yok.</p>
      <button className="button button-secondary" disabled={busy} onClick={tryDemo}>Örnek paketi doğrula · DEMO</button>
    </article>
    <article className="readiness-panel">
      <h2>1. Görevi anlaşmaya bağla</h2>
      <p className="readiness-help">Foundry’den indirdiğin dossier dosyasını seç. Participation veya kasa dosyası burada kullanılmaz. Görev kaydının imzası doğrulanır.</p>
      <div className="readiness-form">
        <label>Foundry dossier · en fazla 512 KiB<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => readFile(event.target.files?.[0], 'dossier')} /></label>
        {job && <label>TCLK teklifinde kullanılacak job alanı<textarea readOnly rows={5} value={job} /><small>Bu değeri anlaşmanın teklifi hazırlanırken kullan. Mevcut imzalı bir teklifi değiştirirsen teklif ve imzaları geçersiz olur.</small></label>}
        <label>TCLK kayıt biçimi<select value={format} disabled={busy} onChange={(event) => { clearResult(); setFormat(event.target.value as WorkDealFormat); }}><option value="raw">Ham tclk1 metni · taraf imzaları kanıtlanmaz</option><option value="technocore-jsonl">Technocore JSONL · mesaj imzaları doğrulanır</option></select></label>
        {format === 'technocore-jsonl' && <label>Kaydın alındığı oda<input value={room} disabled={busy} onChange={(event) => { clearResult(); setRoom(event.target.value); }} placeholder="Odanın tam adı" /></label>}
        <label>TCLK kaydı · en fazla 256 KiB<input type="file" accept=".txt,.jsonl,text/plain,application/x-ndjson" disabled={busy} onChange={(event) => readFile(event.target.files?.[0], 'transcript')} /></label>
        <p>Ödeyen DID görev sahibiyle, alacaklı DID işi üstlenenle eşleşmelidir. Bu araç teklif yayımlamaz, anahtar istemez ve para göndermez.</p>
        <button className="button button-primary" disabled={busy || !files.dossier || !files.transcript || (format === 'technocore-jsonl' && !room)} onClick={() => run('create')}>Bağlantıları doğrula ve paketi hazırla</button>
      </div>
    </article>
    <article className="readiness-panel">
      <h2>2. Kaydedilmiş paketi doğrula</h2>
      <p className="readiness-help">İndirilmiş fwd_…json dosyasını seç. Kaynak kanıtlar ve bağlantı özetleri yeniden hesaplanır. Dosyalar tarayıcıdan çıkmaz.</p>
      <div className="readiness-form"><label>Birleşik paket · en fazla 4 MiB<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => readFile(event.target.files?.[0], 'bundle')} /></label><button className="button button-secondary" disabled={busy || !files.bundle} onClick={() => run('verify')}>Paketi çevrimdışı doğrula</button></div>
    </article>
    {busy && <p className="readiness-banner" role="status">Dosyalar yerelde kontrol ediliyor…</p>}
    {error && <p className="readiness-banner invalid" role="alert">{error}</p>}
    {report && <article className="readiness-panel" aria-live="polite">
      <h2>Kaynaklar ve bağlantılar geçerli</h2>
      <div className="identity-evidence"><span>Paket kimliği</span><code>{report.id}</code><span>SHA-256</span><code>{report.sha256}</code></div>
      <div className="readiness-form">
        <p><strong>Görev:</strong> {report.work.mission.id} · {report.work.mission.title}</p>
        <p><strong>İşin kayıtlı sonucu:</strong> {report.work.selectedState}. <strong>Anlaşma kaydının durumu:</strong> {report.deal.status}.</p>
        <p><strong>TCLK taraf imzaları:</strong> {report.deal.layers.transportDid === 'valid' ? 'Doğrulandı' : 'Ham metinde doğrulanamaz'}. <strong>Sonuç makbuzu:</strong> {report.deal.layers.terminalReceipt === 'valid' ? 'Kaydın durumuyla tutarlı' : 'Henüz yok'}.</p>
        <p><strong>İş kanıtındaki eksikler:</strong> {report.work.gaps.length ? report.work.gaps.join(', ') : 'Dossier doğrulayıcısında ek eksik bulunmadı'}.</p>
        <p>Gerçek ödeme, süreler ve teslim edilen dosyanın içeriği bu paketle doğrulanmış sayılmaz. Dossier bağlantısı yerel bir eşleştirmedir; karşı tarafın bu dossier’ı ayrıca onayladığı anlamına gelmez. Paket kabı imzasızdır; içindeki kanıtlar kendi kurallarıyla doğrulanır.</p>
        {download && <><p>İndirmeden önce kaynak dosyaların paylaşmaya uygun olduğundan emin ol. Paket, seçtiğin TCLK kaydının tamamını içerir.</p><button className="button button-primary" onClick={save}>Birleşik kanıtı indir</button></>}
      </div>
    </article>}
  </section>;
}
