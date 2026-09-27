'use client';
import { useState } from 'react';
import { verifyDeskReport, type Evidence, type SignedDeskReport } from '@/lib/close-call-desk';

const LABEL: Record<Evidence['status'], string> = {
  settled: 'Gerçekleşti', void: 'Void', listed: 'Tahsis listelendi', missed: 'Hakem okumadı',
  hidden: 'Sayı olarak gizli', absent: 'Listelerde yok', pending: 'Süre dolmadı',
};
const compact = (did: string) => `${did.slice(0, 16)}…${did.slice(-6)}`;

function Badge({ evidence }: { evidence: Evidence }) {
  const detail = [evidence.sweep !== null && `tur ${evidence.sweep}`, evidence.hidden > 0 && `${evidence.hidden} gizli`, evidence.reason].filter(Boolean).join(' · ');
  return <span className={`desk-evidence desk-${evidence.status}`} title={detail}>{LABEL[evidence.status]}{evidence.status === 'void' && evidence.reason ? `: ${evidence.reason}` : ''}</span>;
}

/** Verifies an operator-signed desk report in the browser. Reads a file; never signs, posts or stores. */
export default function DeskReport() {
  const [result, setResult] = useState<{ envelope: SignedDeskReport; sha256: string } | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  async function check(source: string) {
    setResult(null); setError('');
    try { setResult(await verifyDeskReport(source)); } catch (e) { setError((e as Error).message); }
  }
  const report = result?.envelope.report;
  return <section className="close-call-card desk-report" aria-labelledby="desk-report-title">
    <p className="micro-label">OTOMATİK MASA / İMZALI OPERATÖR RAPORU</p>
    <h2 id="desk-report-title">Masanın ne yaptığını kanıtla.</h2>
    <p>Otomatik masa (<code>desk.py report</code>) her gün hakem kanıtlarını <code>npm run close-call:desk</code> ile toplar ve operatör DID’i ile imzalar. Raporu buraya yükle: imza ve şekil bu tarayıcıda doğrulanır. Rapor bakiye kanıtı değildir; yalnızca hakemin herkese açık listelerinin ne gösterdiğini söyler.</p>
    <div className="desk-report-input">
      <label>İmzalı rapor dosyası (report-*.json)<input type="file" accept=".json,application/json" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void file.text().then((t) => { setText(''); return check(t); }); }} /></label>
      <label>veya JSON yapıştır<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></label>
      <button className="button-secondary" disabled={!text} onClick={() => void check(text)}>İmzayı ve şekli doğrula</button>
    </div>
    {error && <p className="close-inline-error" role="alert">Geçersiz: {error}</p>}
    {report && result && <div className="close-block" role="status">
      <p className="close-good">✓ Operatör imzası geçerli · hakem akış turu {report.referee.flowSweep} · referans ${report.referee.ref}</p>
      <small>Operatör</small><code className="close-did">{report.operator}</code>
      <small>Rapor sha256 (günlük özet mesajındaki değer)</small><code className="close-did">{result.sha256}</code>
      <h3>Çiftler</h3>
      <div className="close-call-list">{report.pairs.map((p) => <div key={p.pair} className="desk-pair">
        <span><strong>Çift {p.pair}</strong> · {p.long} LONG / {p.short} SHORT<small>{p.status}</small></span>
        <span>{p.attempts.length ? p.attempts.map((a) => <span key={a.id} className="desk-attempt"><code>{a.id}</code> {a.qty} @ {a.px} <Badge evidence={a.evidence} /></span>) : <small>Henüz gönderim yok</small>}</span>
      </div>)}</div>
      <h3>Anahtarlar ve kayıt kanıtı</h3>
      <div className="close-call-list">{report.keys.map((k) => <div key={k.name}>
        <span><strong>{k.name}</strong> <small>{k.role === 'operator' ? 'operatör (ana DID)' : 'masa anahtarı'}</small></span>
        <code title={k.did}>{compact(k.did)}</code>
        {k.registration ? <Badge evidence={k.registration.evidence} /> : <small>kayıt yok</small>}
      </div>)}</div>
      <details className="close-block"><summary>Sınırlar</summary><ul>
        <li>“Sayı olarak gizli”: uygun turlarda hakem sonuçların bir kısmını yalnızca sayı olarak yayımladı (resmî issue #6); sonuç bilinemez.</li>
        <li>“Listelerde yok”: uygun turların listeleri eksiksizdi ve kimlik görünmedi; hakem mesajı okumamış olabilir.</li>
        <li>İddialar sabittir: bakiye kanıtlanmadı, yalnızca hakemin listeledikleri kesin, airdrop garantisi yok.</li>
      </ul></details>
    </div>}
  </section>;
}
