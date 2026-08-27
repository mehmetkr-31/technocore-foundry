import type { Metadata } from 'next';
import Link from 'next/link';
import { getAtlas } from '@/db/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contribution Atlas — Technocore Foundry',
  description: 'A public map of issuer-accepted Technocore Foundry contributions and their separate proof layers.',
};

function compactDid(did: string) {
  return `${did.slice(8, 17)}…${did.slice(-7)}`;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AtlasPage() {
  const atlas = await getAtlas();
  const maxMetric = Math.max(atlas.metrics.missions, atlas.metrics.participants, atlas.metrics.accepted, atlas.metrics.attestations, 1);
  const bars = [
    ['SIGNED MISSIONS', atlas.metrics.missions],
    ['CLAIMANT DIDS', atlas.metrics.participants],
    ['ISSUER ACCEPTED', atlas.metrics.accepted],
    ['PEER ATTESTATIONS', atlas.metrics.attestations],
  ] as const;

  return (
    <main className="artifact-page atlas-page">
      <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><Link href="/">← Enter Foundry</Link></nav>
      <header className="atlas-hero">
        <p className="eyebrow"><span className="pulse-dot" />PUBLIC CONTRIBUTION SURFACE / ACCEPTED ONLY</p>
        <h1>Contribution<br /><em>Atlas.</em></h1>
        <p>Useful work appears here only after an issuer signs acceptance. Cryptography, uploaded bytes, GitHub objects, CI, and issuer judgment stay visible as different facts.</p>
      </header>

      <section className="atlas-metrics" aria-label="Atlas metrics">
        <article><span>OPEN MISSIONS</span><strong>{atlas.metrics.openMissions.toString().padStart(2, '0')}</strong></article>
        <article><span>ACCEPTED BYTES</span><strong>{bytes(atlas.metrics.artifactBytes)}</strong></article>
        {bars.map(([label, value]) => <article className="metric-bar" key={label}><span>{label}</span><strong>{value.toString().padStart(2, '0')}</strong><i style={{ '--bar': `${Math.max(8, (value / maxMetric) * 100)}%` } as React.CSSProperties} /></article>)}
      </section>

      <section className="atlas-ledger">
        <div className="atlas-heading"><div><p className="eyebrow">ISSUER-SIGNED / PORTABLE PROOF</p><h2>Accepted contributions</h2></div><p>This map is a contribution ledger, not a reward, authorship, identity, or airdrop eligibility oracle.</p></div>
        {atlas.contributions.length ? <div className="atlas-list">{atlas.contributions.map((item, index) => {
          const receiptId = item.finalizedReceiptId ?? item.resultId;
          return <article className="atlas-node" key={item.resultId}>
            <span className="atlas-index">{String(index + 1).padStart(2, '0')}</span>
            <div><p>{item.lane} · {item.missionId}</p><h3>{item.missionTitle}</h3><span>{item.artifactName} · {bytes(item.artifactBytes)} · {compactDid(item.actorDid)}</span></div>
            <div className="atlas-proof"><span>ISSUER <b>ACCEPTED</b></span><span>GITHUB <b className={item.evidenceGithub === 'verified' ? '' : 'muted'}>{item.evidenceGithub?.toUpperCase() ?? 'NOT CHECKED'}</b></span><span>CI <b className={item.evidenceCi === 'verified' ? '' : 'muted'}>{item.evidenceCi?.replace('_', ' ').toUpperCase() ?? 'NOT CHECKED'}</b></span><span>PEERS <b className={item.attestationCount ? '' : 'muted'}>{item.attestationCount} EVIDENCE EDGE{item.attestationCount === 1 ? '' : 'S'}</b></span><span>FINAL TCR <b className={item.finalizedReceiptId ? '' : 'muted'}>{item.finalizedReceiptId ? 'BOUND' : 'PENDING'}</b></span></div>
            <Link className="atlas-link" href={`/receipt/${receiptId}`} aria-label={`Open receipt for ${item.missionTitle}`}>↗</Link>
          </article>;
        })}</div> : <div className="atlas-empty"><span>○</span><h3>The accepted map is still empty.</h3><p>Issue a mission, submit an artifact, and let the issuer sign a decision. The first accepted contribution will light up here.</p><Link className="button button-primary" href="/#missions">Browse missions →</Link></div>}
      </section>
      <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>CONTRIBUTION ATLAS</span></div><p>Separate proof layers. Peer edges are evidence types, never scores.</p><span>LIVE / D1 + R2</span></footer>
    </main>
  );
}
