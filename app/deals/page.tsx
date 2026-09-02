import type { Metadata } from 'next';
import Link from 'next/link';
import { TclkInspector } from './tclk-inspector';

export const metadata: Metadata = {
  title: 'Deal Inspector — Technocore Foundry',
  description: 'Inspect a single tclk/1 frame transcript locally without fetching, posting, signing, or settling value.',
};

export default function DealsPage() {
  return <main className="artifact-page deals-page">
    <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/commons">Proof Commons</Link><Link href="/protocol">Protocol Lab</Link><Link href="/">Enter Foundry →</Link></div></nav>
    <header className="deals-hero"><div><p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />TCLK /1 / LOCAL-ONLY / ALPHA PRIMITIVES</p><h1>Deal<br /><em>Inspector.</em></h1><p>Turn a raw tclk/1 transcript into a cautious proof timeline. The work proof and payment coordination layers are intentionally kept separate.</p></div><aside><span>SAFETY PROFILE</span><strong>NO KEYS. NO FUNDS. NO NETWORK.</strong><p>This is analysis for exported bytes—not a wallet, settlement client, offer publisher, or airdrop tool.</p><code>ONE DEAL · 128 FRAMES · 256 KiB</code></aside></header>
    <TclkInspector />
    <section className="deals-footer"><div><p className="eyebrow">UPSTREAM COMPATIBILITY</p><h2>Canonical bytes<br />before confidence.</h2></div><div><p>Compatible with the pinned <code>tclk/1</code> golden offer and acceptance vectors. Point-lock witness mathematics, Technocore transport evidence, deadline timestamps, and settlement-rail evidence are deliberately separate future layers.</p><a className="button button-secondary" href="https://github.com/flop-labs/tclk/tree/81a83464bd909fb5cd80de647da4e42fbae177dd" target="_blank" rel="noreferrer">Read tclk/1 source ↗</a></div></section>
    <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>DEAL INSPECTOR</span></div><p>Frame consistency is not payment finality.</p><span>LOCAL / READ ONLY</span></footer>
  </main>;
}
