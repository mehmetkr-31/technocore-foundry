import { env } from 'cloudflare:workers';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findReceiptMetadata, findResult } from '@/db/queries';
import { EVENT_SCHEMA, type SignedFoundryEvent, type Tcr1Receipt, verifySignedEvent, verifyTcr1Receipt } from '@/lib/foundry-crypto';
import { parseStrictJson } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

async function loadReceipt(id: string) {
  if (!/^(frc|fms|res|fac|tcf)_[a-f0-9]{24}$/.test(id)) return null;
  const metadata = await findReceiptMetadata(id);
  if (!metadata || !env.FILES) return null;
  const object = await env.FILES.get(metadata.objectKey);
  if (!object) return null;
  const payload = parseStrictJson(await object.text()) as Tcr1Receipt | SignedFoundryEvent;
  const result = metadata.resultId ? await findResult(metadata.resultId) : null;
  return { metadata, payload, result };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const record = await loadReceipt(id);
  if (!record) return { title: 'Receipt not found — Technocore Foundry', robots: { index: false, follow: false } };
  const title = `${record.metadata.missionTitle ?? 'Portable proof'} — ${id}`;
  const description = `${record.metadata.schema} signed by ${record.metadata.actorDid.slice(0, 24)}…`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', images: [] },
    twitter: { card: 'summary', title, description, images: [] },
  };
}

function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 18)}…${value.slice(-12)}` : 'NOT PRESENT';
}

export default async function ReceiptPage({ params }: PageProps) {
  const { id } = await params;
  const record = await loadReceipt(id);
  if (!record) notFound();
  const { metadata, payload, result } = record;
  const isTcr1 = 'type' in payload && payload.type === 'technocore-task-receipt';
  const cryptoValid = isTcr1
    ? await verifyTcr1Receipt(payload as Tcr1Receipt)
    : await verifySignedEvent(payload as SignedFoundryEvent);
  const tcr = isTcr1 ? payload as Tcr1Receipt : null;
  const eventSchema = !isTcr1 && 'event' in payload ? payload.event.schema : EVENT_SCHEMA;
  const evidence = result?.evidenceCheckedAt ? {
    github: result.evidenceGithubStatus,
    ci: result.evidenceCiStatus,
    checkedAt: result.evidenceCheckedAt,
    detail: result.evidenceDetail,
  } : null;

  return (
    <main className="artifact-page receipt-page">
      <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/atlas">Contribution Atlas</Link><Link href="/">Enter Foundry →</Link></div></nav>
      <header className="receipt-hero">
        <div><p className="eyebrow"><span className="pulse-dot" />PORTABLE PROOF / {metadata.schema.toUpperCase()}</p><span className="receipt-page-id">{id}</span><h1>{metadata.missionTitle ?? 'Signed contribution receipt'}</h1><p>{metadata.missionLane ?? 'FOUNDRY EVENT'} · observed {new Date(metadata.createdAt).toISOString()}</p></div>
        <div className="receipt-seal"><span>{cryptoValid ? '●' : '○'}</span><strong>{cryptoValid ? 'SIGNATURE VALID' : 'SIGNATURE INVALID'}</strong><small>{isTcr1 ? 'TCR-1 / Ed25519' : `${eventSchema} / Ed25519`}</small></div>
      </header>

      <section className="receipt-proof-grid">
        <article><span>01 / KEY CONTROL</span><strong className={cryptoValid ? 'good' : 'bad'}>{cryptoValid ? 'VALID' : 'INVALID'}</strong><p>The signature verifies against the public key encoded in the signer&apos;s DID.</p></article>
        <article><span>02 / ARTIFACT BYTES</span><strong className={result ? 'good' : 'muted'}>{result ? 'MATCH' : 'NOT APPLICABLE'}</strong><p>{result ? `${result.artifactName} · ${result.artifactBytes} bytes · ${shortHash(result.artifactSha256)}` : 'This receipt does not bind an uploaded result artifact.'}</p></article>
        <article><span>03 / GITHUB OBJECTS</span><strong className={evidence?.github === 'verified' ? 'good' : 'muted'}>{evidence?.github?.toUpperCase() ?? 'NOT CHECKED'}</strong><p>{evidence?.detail ?? 'No user-triggered public GitHub API snapshot is stored.'}</p></article>
        <article><span>04 / CI STATUS</span><strong className={evidence?.ci === 'verified' ? 'good' : 'muted'}>{evidence?.ci?.replace('_', ' ').toUpperCase() ?? 'NOT CHECKED'}</strong><p>{evidence?.checkedAt ? `Snapshot ${evidence.checkedAt}` : 'CI remains separate from GitHub object existence.'}</p></article>
        <article><span>05 / ISSUER DECISION</span><strong className={result?.acceptanceDecision === 'accepted' ? 'good' : result?.acceptanceDecision === 'rejected' ? 'bad' : 'muted'}>{result?.acceptanceDecision?.toUpperCase() ?? 'NOT PRESENT'}</strong><p>{result?.acceptanceNote || 'Issuer acceptance is a separate signed Foundry event.'}</p></article>
        <article><span>06 / FINAL TCR-1</span><strong className={result?.finalReceiptId ? 'good' : 'muted'}>{result?.finalReceiptId ? 'ACCEPTANCE BOUND' : 'NOT FINALIZED'}</strong><p>{result?.finalReceiptId ? shortHash(result.finalReceiptSha256) : 'The claimant has not signed a TCR-1 containing the issuer acceptance hash.'}</p></article>
      </section>

      <section className="receipt-record">
        <div className="record-heading"><div><p className="eyebrow">CANONICAL RECORD / UTF-8 JSON</p><h2>Inspect the exact object.</h2></div><div><a className="button button-primary" href={`/api/receipts/${id}`} download>Download raw JSON</a>{result && <a className="button button-secondary" href={`/api/artifacts/${result.id}`}>Download artifact</a>}</div></div>
        <dl><div><dt>ACTOR DID</dt><dd>{metadata.actorDid}</dd></div><div><dt>RECEIPT SHA-256</dt><dd>{metadata.sha256}</dd></div>{tcr?.evidence?.acceptance_sha256 && <div><dt>ACCEPTANCE SHA-256</dt><dd>{tcr.evidence.acceptance_sha256}</dd></div>}</dl>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </section>
      <aside className="receipt-caveat"><strong>WHAT THIS DOES NOT PROVE</strong><p>It does not establish real-world identity, sole authorship, contribution truth, payment, reward entitlement, or airdrop eligibility. Each proof layer above is deliberately independent.</p></aside>
      <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>PORTABLE PROOF</span></div><p>Useful work, independently inspectable.</p><span>{id}</span></footer>
    </main>
  );
}
