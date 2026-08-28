import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ContributionDossier } from '@/lib/contribution-dossier';
import { canonicalJson, sha256Hex } from '@/lib/foundry-crypto';
import { loadDossierBytes } from '@/lib/server-dossiers';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!/^fds_[a-f0-9]{24}$/.test(id)) return null;
  const loaded = await loadDossierBytes(id);
  if (!loaded) return null;
  const dossier = parseStrictJsonBytes(loaded.bytes) as ContributionDossier;
  const canonical = new TextEncoder().encode(canonicalJson(dossier));
  const digest = await sha256Hex(canonical);
  if (canonical.byteLength !== loaded.bytes.byteLength || digest !== loaded.record.sha256) {
    throw new Error('Dossier canonical bytes do not match storage metadata.');
  }
  return { dossier, record: loaded.record };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) return { title: 'Dossier not found — Technocore Foundry', robots: { index: false, follow: false } };
  return {
    title: `${loaded.dossier.mission.title} — Contribution Dossier`,
    description: `Content-addressed public proof bundle ${id}.`,
  };
}

function short(value: string) {
  return value.length > 36 ? `${value.slice(0, 18)}…${value.slice(-12)}` : value;
}

export default async function DossierPage({ params }: PageProps) {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) notFound();
  const { dossier, record } = loaded;
  const counts = dossier.receipts.reduce<Record<string, number>>((all, receipt) => {
    all[receipt.kind] = (all[receipt.kind] ?? 0) + 1;
    return all;
  }, {});

  return (
    <main className="artifact-page receipt-page dossier-page">
      <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/atlas">Contribution Atlas</Link><Link href="/">Enter Foundry →</Link></div></nav>
      <header className="receipt-hero">
        <div><p className="eyebrow"><span className="pulse-dot" />CONTENT-ADDRESSED / CONTRIBUTION DOSSIER</p><span className="receipt-page-id">{id}</span><h1>{dossier.mission.title}</h1><p>{dossier.mission.lane} · snapshot {dossier.snapshotAt}</p></div>
        <div className="receipt-seal"><span>●</span><strong>CONTENT HASH MATCH</strong><small>UNSIGNED INDEX / EMBEDDED PROOFS</small></div>
      </header>

      <section className="receipt-proof-grid">
        <article><span>01 / SELECTED STATE</span><strong className={dossier.subject.selectedState === 'finalized' ? 'good' : 'muted'}>{dossier.subject.selectedState.replace('_', ' ').toUpperCase()}</strong><p>State is derived from the exact latest immutable result revision and issuer lifecycle records.</p></article>
        <article><span>02 / REVISION CHAIN</span><strong className="good">{dossier.revisionChain.length} REVISION{dossier.revisionChain.length === 1 ? '' : 'S'}</strong><p>Every later revision binds its parent result, parent receipt hash, issuer change request, and claimant revision event.</p></article>
        <article><span>03 / EMBEDDED RECEIPTS</span><strong className="good">{dossier.receipts.length} OBJECT{dossier.receipts.length === 1 ? '' : 'S'}</strong><p>Exact public receipt payloads are embedded with separate canonical and stored-byte hashes.</p></article>
        <article><span>04 / EXECUTION</span><strong className={counts.verification ? 'good' : 'muted'}>{counts.verification ?? 0} RECEIPT{counts.verification === 1 ? '' : 'S'}</strong><p>Execution receipts preserve command and output digests without transcript content.</p></article>
        <article><span>05 / STRUCTURED REVIEW</span><strong className={counts.review ? 'good' : 'muted'}>{counts.review ?? 0} REVIEW{counts.review === 1 ? '' : 'S'}</strong><p>Independent review remains separate from issuer acceptance and cannot mutate lifecycle state.</p></article>
        <article><span>06 / PEER EVIDENCE</span><strong className={counts.attestation ? 'good' : 'muted'}>{counts.attestation ?? 0} EDGE{counts.attestation === 1 ? '' : 'S'}</strong><p>Peer evidence describes an observation; it is not a reputation, payment, or eligibility score.</p></article>
      </section>

      <section className="receipt-record dossier-chain">
        <div className="record-heading"><div><p className="eyebrow">IMMUTABLE CHAIN / LATEST CLAIM</p><h2>Inspect each revision.</h2></div><a className="button button-primary" href={`/api/dossiers/${id}`} download>Download dossier JSON</a></div>
        <dl><div><dt>CONTENT SHA-256</dt><dd>sha256:{record.sha256}</dd></div><div><dt>MISSION / CLAIM</dt><dd>{dossier.subject.missionId} / {dossier.subject.claimId}</dd></div><div><dt>CLAIMANT DID</dt><dd>{dossier.subject.claimantDid}</dd></div><div><dt>SELECTED RESULT</dt><dd>{dossier.subject.selectedResultId}</dd></div></dl>
        <div className="dossier-revisions">{dossier.revisionChain.map((revision) => <article key={revision.resultId}>
          <span>REVISION {String(revision.revision).padStart(2, '0')}</span><h3>{revision.resultId}</h3>
          <p>{revision.artifact.name} · {revision.artifact.bytes} bytes</p><code>{short(revision.artifact.sha256)}</code>
          <div><b>Issuer</b> {revision.issuerOutcome.decision ?? (revision.issuerOutcome.changeRequestReceiptId ? 'changes requested' : 'not present')}</div>
          <div><b>Execution</b> {revision.executionEvidenceReceiptIds.length} · <b>Reviews</b> {revision.reviewReceiptIds.length} · <b>Peers</b> {revision.attestationReceiptIds.length}</div>
          <Link href={`/receipt/${revision.receiptId}`}>Open result proof ↗</Link>
        </article>)}</div>
      </section>

      <section className="receipt-record dossier-receipts">
        <div className="record-heading"><div><p className="eyebrow">EMBEDDED PUBLIC PROOFS</p><h2>Receipt index.</h2></div></div>
        <div className="dossier-receipt-list">{dossier.receipts.map((receipt) => <article key={receipt.id}><span>{receipt.kind.replace('_', ' ').toUpperCase()}</span><Link href={receipt.proofPath}>{receipt.id}</Link><code>{short(receipt.canonicalSha256)}</code></article>)}</div>
      </section>

      <aside className="receipt-caveat"><strong>BOUNDED CLAIM</strong><p>{dossier.caveats.join(' ')}</p><p>Limitations: {dossier.limitations.join(', ')}.</p></aside>
      <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>CONTRIBUTION DOSSIER</span></div><p>Portable graph, independently inspectable layers.</p><span>{id}</span></footer>
    </main>
  );
}
