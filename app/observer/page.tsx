import type { Metadata } from 'next';
import Link from 'next/link';
import { getObserverIndex } from '@/db/queries';
import { FOUNDRY_ROOM, TECHNOCORE_SOURCE_COMMIT } from '@/lib/technocore-observer';
import ObserverSync from './observer-sync';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Transport Observer — Technocore Foundry',
  description: 'A fixed-lane, gap-aware Technocore observation index that keeps transport sightings separate from cryptographic proof.',
};

function compactDid(value: string) {
  return value.startsWith('did:key:') ? `${value.slice(8, 17)}…${value.slice(-7)}` : value;
}

export default async function ObserverPage() {
  const index = await getObserverIndex(FOUNDRY_ROOM);
  return <main className="artifact-page observer-page">
    <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/commons">Commons</Link><Link href="/atlas">Atlas</Link><Link href="/security">Security</Link><Link href="/">Enter Foundry →</Link></div></nav>
    <header className="observer-hero">
      <p className="eyebrow"><span className="pulse-dot" />FIXED LANE / USER-TRIGGERED / READ ONLY</p>
      <h1>Transport<br /><em>Observer.</em></h1>
      <p>Foundry watches only <code>{FOUNDRY_ROOM}</code>. The JSON read lane omits historical signatures, so every sighting is labeled transport-unverifiable—not “verified,” trusted, or eligible.</p>
      <ObserverSync />
    </header>

    <section className="atlas-metrics" aria-label="Observer metrics">
      <article><span>OBSERVATIONS</span><strong>{index.metrics.observations.toString().padStart(2, '0')}</strong></article>
      <article><span>RECEIPT POINTERS</span><strong>{index.metrics.receiptLinks.toString().padStart(2, '0')}</strong></article>
      <article><span>DID WRITER HINTS</span><strong>{index.metrics.didWriters.toString().padStart(2, '0')}</strong></article>
      <article><span>EPOCHS / GAPS</span><strong>{index.metrics.epochs} / {index.metrics.gaps}</strong></article>
    </section>

    <section className="observer-ledger">
      <div className="atlas-heading"><div><p className="eyebrow">HASH-ONLY / HOSTILE TEXT QUARANTINED</p><h2>Recent sightings</h2></div><p>Raw remote text is neither stored nor rendered. Only a SHA-256 digest, safe receipt identifier, sequence, timestamp, and bounded actor hint enter the index.</p></div>
      {index.observations.length ? <div className="observer-list">{index.observations.map((item) => <article key={item.id}>
        <div><span>EPOCH {item.epoch} · SEQ {item.sequence}</span><strong>{compactDid(item.actorHint)}</strong><code>{item.textSha256}</code></div>
        <div><span>{item.receiptId ? <Link href={`/receipt/${item.receiptId}`}>{item.receiptId}</Link> : 'NO SAFE RECEIPT POINTER'}</span><b>TRANSPORT UNVERIFIABLE</b><time>{item.serverTimestamp}</time></div>
      </article>)}</div> : <div className="atlas-empty"><span>○</span><h3>No lane observation has been requested.</h3><p>Use the manual control above. Foundry never polls this external lane automatically.</p></div>}
    </section>

    <section className="epoch-ledger">
      <div><p className="eyebrow">ROOM LIFETIMES</p><h2>Epoch and gap ledger</h2></div>
      <div className="epoch-grid">{index.epochs.map((epoch) => <article key={epoch.id}><span>EPOCH {epoch.epoch}</span><strong>{epoch.startSeq} → {epoch.endSeq}</strong><small>{epoch.gapCount} explicit gap{epoch.gapCount === 1 ? '' : 's'} · last read {epoch.lastSyncAt}</small></article>)}</div>
      {index.gaps.map((gap) => <p className="gap-row" key={gap.id}>{gap.kind.toUpperCase().replace('_', ' ')} · expected {gap.expectedSeq}, first observed {gap.firstSeq} · epoch {gap.epoch}</p>)}
    </section>

    <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>TRANSPORT OBSERVER</span></div><p>Source contract pinned to <a href={`https://github.com/flop-labs/technocore-chat/commit/${TECHNOCORE_SOURCE_COMMIT}`}>{TECHNOCORE_SOURCE_COMMIT.slice(0, 8)}</a>.</p><span>READ ONLY / NO SCORE</span></footer>
  </main>;
}
