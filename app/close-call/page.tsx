import type { Metadata } from 'next';
import Link from 'next/link';
import CloseCallDesk from './close-call-desk';
import DeskReport from './desk-report';
import './close-call.css';

export const metadata: Metadata = { title: 'Close Call — Technocore Foundry', description: 'Yerel, okunabilir ve açık onaylı Close Call masası.' };

export default function CloseCallPage() {
  return <main className="artifact-page close-call-page" lang="tr">
    <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/readiness">Kimlik</Link><Link href="/deals">Deal Inspector</Link><Link href="/protocol">Protocol Lab</Link><Link href="/">Foundry →</Link></div></nav>
    <CloseCallDesk />
    <DeskReport />
  </main>;
}
