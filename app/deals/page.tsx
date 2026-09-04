import type { Metadata } from 'next';
import Link from 'next/link';
import { TCLK_OPERATIONAL_COMMIT } from '@/lib/tclk-contract';
import { TclkInspector } from './tclk-inspector';

export const metadata: Metadata = {
  title: 'Deal Inspector — Technocore Foundry',
  description: 'Inspect a tclk/1 transcript or signed Technocore JSONL export locally without fetching, posting, signing, or settling value.',
};

export default function DealsPage() {
  return <main className="artifact-page deals-page">
    <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/commons">Proof Commons</Link><Link href="/protocol">Protocol Lab</Link><Link href="/">Enter Foundry →</Link></div></nav>
    <header className="deals-hero"><div><p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />TCLK /1 / LOCAL-ONLY / ALPHA PRIMITIVES</p><h1>Deal<br /><em>Inspector.</em></h1><p>Turn raw tclk/1 frames or a signed Technocore room export into a cautious proof timeline. The work proof and payment coordination layers are intentionally kept separate.</p></div><aside><span>SAFETY PROFILE</span><strong>NO KEYS. NO FUNDS. NO NETWORK.</strong><p>This is analysis for exported bytes—not a wallet, settlement client, offer publisher, or airdrop tool.</p><code>ONE DEAL · 128 FRAMES · EXPORT 16 MiB</code></aside></header>
    <TclkInspector />
    <section className="deals-footer"><div><p className="eyebrow">UPSTREAM COMPATIBILITY</p><h2>Canonical bytes<br />before confidence.</h2></div><div><p>Compatible with the pinned <code>tclk/1</code> golden offer and acceptance vectors. A room export can prove each selected author signature; unsigned server ordering, timestamps, generation, inclusion, point-lock witness mathematics, and settlement-rail evidence remain separate layers.</p><a className="button button-secondary" href={`https://github.com/flop-labs/tclk/tree/${TCLK_OPERATIONAL_COMMIT}`} target="_blank" rel="noreferrer">Read tclk/1 source ↗</a></div></section>
    <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>DEAL INSPECTOR</span></div><p>Frame consistency is not payment finality.</p><span>LOCAL / READ ONLY</span></footer>
  </main>;
}
