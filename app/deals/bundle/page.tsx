import type { Metadata } from 'next';
import Link from 'next/link';
import WorkDealWorkbench from './work-deal-workbench';
import WorkDealV2Workbench from './work-deal-v2-workbench';

export const metadata: Metadata = {
  title: 'Görev ve anlaşma kanıtı — Technocore Foundry',
  description: 'Foundry dossier ve TCLK kayıtlarını yerelde eşleştir, tek dosyada sakla ve çevrimdışı doğrula.',
};

export default function WorkDealPage() {
  return <main className="artifact-page readiness-page" lang="tr">
    <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/deals">Anlaşma inceleyici</Link><Link href="/readiness">Kimlik hazırlığı</Link></div></nav>
    <header className="readiness-next"><h1>Görev, teslimat ve anlaşma: tek kanıt dosyası.</h1><p>Mevcut imzalı kayıtları eşleştir. İşin sonucu ve ödeme koordinasyonu ayrı değerlendirilir.</p></header>
    <WorkDealV2Workbench />
    <details className="readiness-panel"><summary>Eski v1 paketleri ve örnek demo</summary><WorkDealWorkbench /></details>
  </main>;
}
