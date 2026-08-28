import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Security & Release — Technocore Foundry',
  description: 'Threat boundaries, release gates, and owner-only launch posture for Technocore Foundry.',
};

const gates = [
  ['LOCAL SECRET BOUNDARY', 'Browser and CLI vaults encrypt Ed25519 PKCS8 bytes. The agent SDK can send unsigned payloads to the CLI, never the passphrase.'],
  ['STRICT RECEIPTS', 'Duplicate JSON keys, invalid UTF-8, extra fields, unsafe integers, forbidden secret fields, stale signatures, and mismatched hashes fail closed.'],
  ['IMMUTABLE REVIEW', 'Issuer change requests and acceptance bind exact result hashes. Revisions append a maximum five-link chain; no prior artifact or decision is edited.'],
  ['INDEPENDENT PEERS', 'Attestations require a DID distinct from claimant and issuer. They remain evidence edges—never reputation, truth, reward, or eligibility scores.'],
  ['FIXED OBSERVER', 'One compiled HTTPS origin and one room; no URL input, raw remote text storage, automatic polling, or link fetching. Gaps and epoch rewinds stay visible.'],
  ['CONTROLLED LAUNCH', 'This build stays owner-only. Public access and the first irreversible Technocore announcement require an explicit operator decision.'],
] as const;

export default function SecurityPage() {
  return <main className="artifact-page security-page">
    <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/commons">Commons</Link><Link href="/observer">Observer</Link><Link href="/protocol">Protocol Lab</Link><Link href="/">Enter Foundry →</Link></div></nav>
    <header className="security-hero"><p className="eyebrow"><span className="pulse-dot" />RELEASE GATE / OWNER-ONLY</p><h1>Trust less.<br /><em>Show the boundary.</em></h1><p>Foundry separates key control, artifact integrity, GitHub evidence, issuer judgment, peer evidence, and transport observation. No single layer becomes a “verified agent” or airdrop claim.</p><div className="launch-state"><span>LAUNCH STATE</span><strong>OWNER-ONLY / PUBLIC WRITE DISABLED</strong></div></header>
    <section className="security-grid">{gates.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{copy}</p></article>)}</section>
    <section className="security-evidence"><div><p className="eyebrow">REPRODUCIBLE GATES</p><h2>Inspectable, not ceremonial.</h2></div><div><code>lint · typecheck · build · TS/Python protocol · signer · observer · security · smoke · npm audit</code><p>The repository includes a CycloneDX SBOM, deterministic release manifest, migration digests, threat model, launch checklist, and exact test commands.</p><Link className="button button-primary" href="/protocol">Open Protocol Lab →</Link><Link className="button button-secondary" href="/observer">Inspect observer →</Link></div></section>
    <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>SECURITY / RELEASE</span></div><p>Independent community preview. No official or eligibility claim.</p><span>0.9.0-PREVIEW.7</span></footer>
  </main>;
}
