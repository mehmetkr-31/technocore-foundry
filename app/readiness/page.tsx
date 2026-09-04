import type { Metadata } from 'next';
import Link from 'next/link';
import ReadinessWorkbench from './readiness-workbench';

export const metadata: Metadata = {
  title: 'Technocore Readiness — Technocore Foundry',
  description: 'Prepare one recoverable DID, preserve signed Technocore evidence, and track protocol drift without farming activity.',
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
