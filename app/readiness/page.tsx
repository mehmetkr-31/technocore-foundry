import type { Metadata } from 'next';
import Link from 'next/link';
import ReadinessWorkbench from './readiness-workbench';

export const metadata: Metadata = {
  title: 'Kimlik ve katkı hazırlığı — Technocore Foundry',
  description: 'Mevcut DID kasanı yükle, yedeğini test et ve katkı kanıtını doğru kimlikle imzala.',
};

export default function ReadinessPage() {
  return (
    <main className="artifact-page readiness-page">
      <nav className="artifact-nav">
        <Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link>
        <div><Link href="/commons">Commons</Link><Link href="/deals">Deal Inspector</Link><Link href="/protocol">Protocol Lab</Link><Link href="/">Foundry →</Link></div>
      </nav>

      <ReadinessWorkbench />
    </main>
  );
}
