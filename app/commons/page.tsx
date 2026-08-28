import type { Metadata } from 'next';
import Link from 'next/link';
import commonsIndexJson from '@/public/commons/index.json';

export const metadata: Metadata = {
  title: 'Proof Commons — Technocore Foundry',
  description: 'A read-only, Git-moderated index of offline-verifiable contribution dossiers and their open proof gaps.',
};

type ProofGap = 'execution_evidence' | 'structured_review' | 'peer_evidence' | 'artifact_bytes';
type LayerState = 'valid' | 'absent' | 'not_checked';
type CommonsEntry = {
  id: string;
  dossierSha256: string;
  missionId: string;
  missionTitle: string;
  missionLane: string;
  missionSummary: string;
  claimantDid: string;
  issuerDid: string;
  roleSeparation: 'same_key' | 'distinct_keys';
  selectedResultId: string;
  selectedState: 'accepted' | 'finalized';
  revisionCount: number;
  receiptCount: number;
  receiptCounts: { execution: number; structuredReview: number; peerEvidence: number };
  artifact: { mediaType: string; bytes: number; sha256: string };
  layers: {
    contentAddress: LayerState;
    receiptSignatures: LayerState;
    missionAndClaim: LayerState;
    revisionChain: LayerState;
    issuerOutcome: LayerState;
    executionEvidence: LayerState;
    structuredReview: LayerState;
    peerEvidence: LayerState;
    artifact: LayerState;
  };
  proofGaps: ProofGap[];
  sourcePath: string;
};
type CommonsIndex = {
  schema: 'foundry-proof-commons-index-v1';
  policyVersion: string;
  registryPath: string;
  metrics: { dossiers: number; participants: number; receipts: number; proofGaps: number };
  entries: CommonsEntry[];
};

const commonsIndex = commonsIndexJson as CommonsIndex;
const views = [
  ['all', 'ALL PROOFS', null],
  ['reproduce', 'REPRODUCE', 'execution_evidence'],
  ['review', 'REVIEW', 'structured_review'],
  ['peer', 'PEER EVIDENCE', 'peer_evidence'],
  ['artifact', 'ARTIFACT BYTES', 'artifact_bytes'],
] as const;

function compactDid(did: string) {
  return `${did.slice(8, 17)}…${did.slice(-7)}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function gapLabel(gap: ProofGap) {
  return {
    execution_evidence: 'REPRODUCE',
    structured_review: 'REVIEW',
    peer_evidence: 'PEER EVIDENCE',
    artifact_bytes: 'CHECK ARTIFACT BYTES',
  }[gap];
}

type PageProps = { searchParams: Promise<{ view?: string }> };

export default async function CommonsPage({ searchParams }: PageProps) {
  const requestedView = (await searchParams).view ?? 'all';
  const activeView = views.some(([value]) => value === requestedView) ? requestedView : 'all';
  const gap = views.find(([value]) => value === activeView)?.[2] ?? null;
  const entries = gap ? commonsIndex.entries.filter((entry) => entry.proofGaps.includes(gap)) : commonsIndex.entries;

  return (
    <main className="artifact-page commons-page">
      <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/atlas">Atlas</Link><Link href="/protocol">Protocol Lab</Link><Link href="/">Enter Foundry →</Link></div></nav>

      <header className="commons-hero">
        <div>
          <p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />READ ONLY / GIT MODERATED / NO SCORE</p>
          <h1>Proof<br /><em>Commons.</em></h1>
          <p>Accepted work, waiting for the next proof. Every entry is a content-addressed dossier that passed offline signature and hash-chain verification.</p>
        </div>
        <aside className="commons-boundary">
          <span>ADMISSION BOUNDARY</span>
          <strong>PR → OFFLINE CI → REVIEW</strong>
          <p>No upload API. No URL fetch. No hosted artifact. Missing evidence is an invitation—not a failure, rank, or reward prediction.</p>
          <code>{commonsIndex.policyVersion}</code>
        </aside>
      </header>

      <section className="atlas-metrics commons-metrics" aria-label="Commons metrics">
        <article><span>INDEXED DOSSIERS</span><strong>{commonsIndex.metrics.dossiers.toString().padStart(2, '0')}</strong></article>
        <article><span>PARTICIPATING KEYS</span><strong>{commonsIndex.metrics.participants.toString().padStart(2, '0')}</strong></article>
        <article><span>SIGNED RECEIPTS</span><strong>{commonsIndex.metrics.receipts.toString().padStart(2, '0')}</strong></article>
        <article><span>OPEN PROOF GAPS</span><strong>{commonsIndex.metrics.proofGaps.toString().padStart(2, '0')}</strong></article>
      </section>

      <section className="atlas-ledger commons-ledger">
        <div className="atlas-heading"><div><p className="eyebrow">PROOF GAP QUEUE / CONCRETE NEXT ACTIONS</p><h2>Strengthen a public proof.</h2></div><p>Cryptographic validity, issuer judgment, execution evidence, structured review, peer observation, and artifact bytes remain separate facts.</p></div>
        <nav className="commons-filters" aria-label="Filter proof gaps">
          {views.map(([value, label]) => <Link key={value} href={value === 'all' ? '/commons' : `/commons?view=${value}`} aria-current={activeView === value ? 'page' : undefined}>{label}</Link>)}
        </nav>

        {entries.length ? <div className="commons-list">{entries.map((entry, index) => {
          const sourceUrl = `https://github.com/mehmetkr-31/technocore-foundry/blob/main/${entry.sourcePath}`;
          return <article className="commons-row" key={entry.id}>
            <span className="atlas-index">{String(index + 1).padStart(2, '0')}</span>
            <div className="commons-copy">
              <div className="commons-opportunities"><span>INSPECT</span>{entry.proofGaps.map((item) => <span key={item}>{gapLabel(item)}</span>)}</div>
              <p>{entry.missionLane} · {entry.missionId} · {entry.selectedState.toUpperCase()}</p>
              <h3>{entry.missionTitle}</h3>
              <p>{entry.missionSummary}</p>
              <code>{entry.id} · {compactDid(entry.claimantDid)} · {formatBytes(entry.artifact.bytes)}</code>
            </div>
            <dl className="commons-proof">
              <div><dt>CONTENT + SIGNATURES</dt><dd>PRESENT</dd></div>
              <div><dt>ISSUER OUTCOME</dt><dd>{entry.selectedState.toUpperCase()}</dd></div>
              <div><dt>EXECUTION</dt><dd className={entry.layers.executionEvidence === 'valid' ? 'good' : 'muted'}>{entry.layers.executionEvidence === 'valid' ? `${entry.receiptCounts.execution} PRESENT` : 'NOT PRESENT'}</dd></div>
              <div><dt>STRUCTURED REVIEW</dt><dd className={entry.layers.structuredReview === 'valid' ? 'good' : 'muted'}>{entry.layers.structuredReview === 'valid' ? `${entry.receiptCounts.structuredReview} PRESENT` : 'NOT PRESENT'}</dd></div>
              <div><dt>PEER EVIDENCE</dt><dd className={entry.layers.peerEvidence === 'valid' ? 'good' : 'muted'}>{entry.layers.peerEvidence === 'valid' ? `${entry.receiptCounts.peerEvidence} PRESENT` : 'NOT PRESENT'}</dd></div>
              <div><dt>KEY ROLES</dt><dd className={entry.roleSeparation === 'distinct_keys' ? 'good' : 'muted'}>{entry.roleSeparation === 'distinct_keys' ? 'DISTINCT' : 'SAME KEY'}</dd></div>
            </dl>
            <a className="atlas-link" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`Inspect canonical dossier for ${entry.missionTitle}`}>↗</a>
          </article>;
        })}</div> : <div className="commons-empty">
          <div className="atlas-empty"><span>○</span><h3>{commonsIndex.entries.length ? 'No dossier matches this proof gap.' : 'The moderated registry is empty.'}</h3><p>{commonsIndex.entries.length ? 'Choose another filter. Absence is not a negative score.' : 'No synthetic record is mixed with public contributions. The first entry must pass the same offline admission contract as every later dossier.'}</p><a className="button button-secondary" href="https://github.com/mehmetkr-31/technocore-foundry/tree/main/commons" target="_blank" rel="noreferrer">Inspect registry policy ↗</a></div>
          {commonsIndex.entries.length === 0 && <ol className="commons-onramp">
            <li><span>01</span><div><strong>EXPORT</strong><p>Finish a signed mission lifecycle locally and export its latest canonical dossier.</p></div></li>
            <li><span>02</span><div><strong>VERIFY</strong><p>Run the offline verifier against the exact bytes. Artifact bytes remain a separate optional check.</p></div></li>
            <li><span>03</span><div><strong>PROPOSE</strong><p>Add one <code>commons/dossiers/fds_….json</code> file in a pull request. CI accepts no other change.</p></div></li>
          </ol>}
        </div>}
      </section>

      <section className="commons-command">
        <div><p className="eyebrow">REPRODUCE LOCALLY</p><h2>Trust the bytes, not this page.</h2></div>
        <div><code>node packages/signer-cli/bin/foundry-signer.mjs verify-dossier --input commons/dossiers/fds_….json</code><p>The command requires no vault, passphrase, account, API key, artifact download, or network request.</p></div>
      </section>

      <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>PROOF COMMONS</span></div><p>Immutable dossiers. Separate proof layers. No ranking.</p><span>GIT / OFFLINE VERIFIED</span></footer>
    </main>
  );
}
