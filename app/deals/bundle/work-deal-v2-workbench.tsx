'use client';

import { useEffect, useRef, useState } from 'react';
import { BROWSER_DOSSIER_MAX_BYTES } from '@/lib/browser-dossier-verifier.mjs';
import { MULTIROOM_MAX_BYTES } from '@/lib/tclk-multiroom';
import { decodeStrictUtf8, parseStrictJson } from '@/lib/strict-json';
import { createInspectorRunGate } from '@/lib/inspector-run-gate';
import { createWorkDealBundleV2, verifyWorkDealBundleV2, paperSnapshotFromObservation,
  WORK_DEAL_V2_MAX_BYTES, type PaperSnapshot } from '@/lib/work-deal-bundle-v2';

type Kind = 'dossier' | 'offers' | 'agreement' | 'observation' | 'bundle';
type Report = Awaited<ReturnType<typeof verifyWorkDealBundleV2>>;
const paperLabels: Record<string, string> = {
  absent: 'Gözlem eklenmedi', 'saved-body-consistent': 'Saklanan metin anlaşmayla tutarlı; kaynağı kanıtlanmadı',
  inconsistent: 'Saklanan gözlem anlaşmayla uyuşmuyor', 'reported-missing': 'Raporda not bulunamadığı belirtilmiş',
  'no-replayable-body': 'Tekrar incelenebilir yanıt metni yok', 'reported-http-error': 'Raporda HTTP hatası belirtilmiş',
  'not-applicable': 'Bu anlaşma için uygulanamaz', 'malformed-body': 'Kaydedilen notun biçimi geçersiz',
};

async function read(file: File | undefined, max: number, allowEmpty = false) {
  if (!file) throw new Error('Gerekli dosyaları seç.');
  if ((!allowEmpty && !file.size) || file.size > max) throw new Error(`${file.name}: dosya boş veya ${max / 1024} KiB sınırını aşıyor.`);
  return new Uint8Array(await file.arrayBuffer());
}

export default function WorkDealV2Workbench() {
  const [files, setFiles] = useState<Partial<Record<Kind, File>>>({});
  const [contract, setContract] = useState('');
  const [report, setReport] = useState<Report>();
  const [download, setDownload] = useState<Uint8Array>();
  const [shareable, setShareable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createInspectorRunGate());
  const running = useRef(false);
  useEffect(() => { const current = gate.current; return () => current.cancel(); }, []);

  function reset() { gate.current.cancel(); setReport(undefined); setDownload(undefined); setError(''); setShareable(false); }
  function choose(kind: Kind, file?: File) { reset(); setFiles(current => ({ ...current, [kind]: file })); }

  async function run(mode: 'create' | 'verify') {
    if (running.current) return;
    running.current = true; reset(); const token = gate.current.begin(); setBusy(true);
    try {
      if (mode === 'verify') {
        const result = await verifyWorkDealBundleV2(await read(files.bundle, WORK_DEAL_V2_MAX_BYTES));
        if (gate.current.isCurrent(token)) setReport(result);
      } else {
        const [dossier, offers, agreement] = await Promise.all([
          read(files.dossier, BROWSER_DOSSIER_MAX_BYTES), read(files.offers, MULTIROOM_MAX_BYTES),
          read(files.agreement, MULTIROOM_MAX_BYTES, true),
        ]);
        let observation: PaperSnapshot | null = null;
        if (files.observation) {
          const value = parseStrictJson(decodeStrictUtf8(await read(files.observation, 512 * 1024)));
          if (!value || typeof value !== 'object' || Array.isArray(value) || !('paperObservation' in value)
            || !value.paperObservation || typeof value.paperObservation !== 'object' || Array.isArray(value.paperObservation)) {
            throw new Error('Gözlem dosyası, paperObservation içeren deal:audit JSON raporu olmalı.');
          }
          // The core validates every copied field; the collector verdict is not trusted.
          observation = paperSnapshotFromObservation(value.paperObservation as PaperSnapshot);
        }
        const result = await createWorkDealBundleV2(dossier, offers, agreement, contract.trim(), observation);
        if (gate.current.isCurrent(token)) { setReport(result.report); setDownload(result.bytes); }
      }
    } catch (cause) {
      if (gate.current.isCurrent(token)) setError(cause instanceof Error ? cause.message : 'Kontrol tamamlanamadı.');
    } finally { running.current = false; if (gate.current.isCurrent(token)) setBusy(false); }
  }

  function save() {
    if (!download || !report || !shareable) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(download)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${report.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="readiness-workflow" aria-label="İki odalı kanıt paketi">
    <article className="readiness-panel">
      <h2>Bu ekran ne işe yarıyor?</h2>
      <p>Bir ajanla yaptığın işin kayıtlarını tek dosyada saklar ve imzalarını kontrol eder. Kimlik oluşturmaz, mesaj yayımlamaz ve ödeme yapmaz. Anahtar veya parola istemez.</p>
      <p className="readiness-help">Henüz gerçek bir görev ve anlaşma yoksa burada yapman gereken bir şey yok. Daha önce indirdiğin participation kanıtı veya vault yedeği bu ekranın girdisi değildir.</p>
    </article>
    <article className="readiness-panel">
      <h2>1. İşin kayıtlarını seç</h2>
      <div className="readiness-form">
        <label>Görev kanıtı · Foundry dossier · en fazla 512 KiB<input type="file" accept=".json" disabled={busy} onChange={e => choose('dossier', e.target.files?.[0])} /></label>
        <label>Teklif odasının kaydı · tclk-offers JSONL · en fazla 2 MiB<input type="file" accept=".jsonl,.txt" disabled={busy} onChange={e => choose('offers', e.target.files?.[0])} /></label>
        <label>Anlaşma odasının kaydı · mb-p-tclk-… JSONL · en fazla 2 MiB<input type="file" accept=".jsonl,.txt" disabled={busy} onChange={e => choose('agreement', e.target.files?.[0])} /></label>
        <label>Tam sözleşme kimliği · 0x ve 64 onaltılık karakter<input value={contract} disabled={busy} spellCheck={false} onChange={e => { reset(); setContract(e.target.value); }} placeholder="0x…" /></label>
        <details><summary>İsteğe bağlı: kaydedilmiş PaperRail gözlemi</summary>
          <p>deal:audit --paper çıktısını JSON dosyası olarak seçebilirsin. Canlı sorgu yapılmaz; raporun sunucudan geldiği kanıtlanamaz.</p>
          <label>Gözlem raporu · en fazla 512 KiB<input type="file" accept=".json" disabled={busy} onChange={e => choose('observation', e.target.files?.[0])} /></label>
        </details>
        <p>Teklifteki görev ve taraflar dossier ile eşleşmelidir. Dosyaların içeriğini düzeltmek için imzalı kayıtları elle değiştirme.</p>
        <button className="button button-primary" disabled={busy || !files.dossier || !files.offers || !files.agreement || !contract.trim()} onClick={() => run('create')}>Kontrol et ve paketi hazırla</button>
      </div>
    </article>
    <article className="readiness-panel">
      <h2>2. Daha önce indirdiğin v2 paketi doğrula</h2>
      <p>Tek dosya yeterli. İçindeki imzalar ve bağlantılar yeniden hesaplanır; dosya tarayıcıdan çıkmaz.</p>
      <div className="readiness-form">
        <label>fwd2_…json paketi · en fazla 12 MiB<input type="file" accept=".json" disabled={busy} onChange={e => choose('bundle', e.target.files?.[0])} /></label>
        <button className="button button-secondary" disabled={busy || !files.bundle} onClick={() => run('verify')}>Kaydedilmiş paketi doğrula</button>
      </div>
    </article>
    {busy && <p className="readiness-banner" role="status">Dosyalar bu cihazda kontrol ediliyor…</p>}
    {error && <p className="readiness-banner invalid" role="alert">{error}</p>}
    {report && <article className="readiness-panel" aria-live="polite">
      <h2>İmzalar ve görev bağlantıları doğrulandı</h2>
      <p>Bu sonuç işin tamamlandığı veya ödemenin yapıldığı anlamına gelmez.</p>
      <div className="identity-evidence"><span>Paket kimliği</span><code>{report.id}</code><span>SHA-256</span><code>{report.sha256}</code></div>
      <p><strong>Görev:</strong> {report.work.mission.title} · {report.work.selectedState}</p>
      <p><strong>Anlaşma:</strong> {report.deal.verifiedStatus} · {report.deal.terminal ? 'Son durum kaydı var' : 'Süreç henüz sonlanmamış'}</p>
      <p><strong>İş kanıtındaki eksikler:</strong> {report.work.gaps.length ? report.work.gaps.join(', ') : 'Dossier denetiminde ek eksik bulunmadı'}</p>
      <p><strong>PaperRail:</strong> {paperLabels[report.paper.state] ?? report.paper.state}</p>
      <p>Zaman ve sıra bilgileri imzasızdır. PaperRail gerçek para taşımaz. Paket; gerçek ödemeyi, teslim edilen dosyanın içeriğini, iş kalitesini veya airdrop hakkını kanıtlamaz. Dossier bağlantısı karşı tarafın ayrıca onayı değildir.</p>
      {download && <div className="readiness-form">
        <label><input type="checkbox" checked={shareable} onChange={e => setShareable(e.target.checked)} />Paketin iki odanın tüm kayıtlarını ve varsa gözlem metnini içerdiğini biliyorum; paylaşılabilirliğini kontrol ettim.</label>
        <button className="button button-primary" disabled={!shareable} onClick={save}>Paketi indir</button>
      </div>}
    </article>}
  </section>;
}
