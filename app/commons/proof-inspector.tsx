'use client';

import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import {
  BROWSER_ARTIFACT_MAX_BYTES,
  BROWSER_DOSSIER_MAX_BYTES,
  BrowserDossierError,
  type BrowserDossierVerification,
  type BrowserLayerState,
  verifyDossierInBrowser,
} from '@/lib/browser-dossier-verifier.mjs';
import { createInspectorRunGate } from '@/lib/inspector-run-gate';

type InspectorError = { code: string; stage: string; message: string };

const layerLabels: Array<[keyof BrowserDossierVerification['layers'], string]> = [
  ['contentAddress', 'CONTENT ADDRESS'],
  ['receiptSignatures', 'RECEIPT SIGNATURES'],
  ['missionAndClaim', 'MISSION + CLAIM'],
  ['revisionChain', 'REVISION CHAIN'],
  ['issuerOutcome', 'ISSUER OUTCOME'],
  ['executionEvidence', 'EXECUTION EVIDENCE'],
  ['structuredReview', 'STRUCTURED REVIEW'],
  ['peerEvidence', 'PEER EVIDENCE'],
  ['artifact', 'ARTIFACT BYTES'],
];

const gapCopy: Record<string, [string, string]> = {
  mission_receipt: ['OBTAIN SIGNED MISSION', 'This seed mission has no issuer-signed mission receipt; the claimant receipt remains valid, but the mission snapshot is unsigned.'],
  issuer_outcome: ['OBTAIN ISSUER OUTCOME', 'Ask the mission issuer to sign a decision bound to the latest result hash.'],
  execution_evidence: ['REPRODUCE EXECUTION', 'Add a signed verification receipt containing deterministic zero-exit checks.'],
  structured_review: ['REQUEST INDEPENDENT REVIEW', 'A DID distinct from claimant and issuer can review the exact result receipt.'],
  peer_evidence: ['ADD PEER OBSERVATION', 'A distinct DID can attest only to something it independently observed.'],
  artifact_bytes: ['CHECK ARTIFACT BYTES', 'Choose the exact artifact locally to compare its byte length and SHA-256.'],
  artifact_mismatch: ['SELECT THE EXACT ARTIFACT', 'The supplied file does not match the selected revision digest and size.'],
};

function compactDid(did: string) {
  return `${did.slice(8, 17)}…${did.slice(-7)}`;
}

function stateLabel(state: BrowserLayerState) {
  return state === 'valid' ? 'VALID' : state === 'absent' ? 'ABSENT' : state === 'mismatch' ? 'MISMATCH' : 'NOT CHECKED';
}

function stateClass(state: BrowserLayerState) {
  return state === 'valid' ? 'good' : state === 'mismatch' ? 'bad' : 'muted';
}

export function ProofInspector() {
  const runGate = useRef(createInspectorRunGate());
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const verdict = useRef<HTMLElement>(null);
  const dossierInput = useRef<HTMLInputElement>(null);
  const artifactInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'verifying' | 'valid' | 'invalid'>('idle');
  const [dragging, setDragging] = useState(false);
  const [dossierBytes, setDossierBytes] = useState<Uint8Array>();
  const [dossierName, setDossierName] = useState('');
  const [artifactName, setArtifactName] = useState('');
  const [baseResult, setBaseResult] = useState<BrowserDossierVerification>();
  const [result, setResult] = useState<BrowserDossierVerification>();
  const [error, setError] = useState<InspectorError>();
  const [artifactError, setArtifactError] = useState('');

  function focus(ref: { current: HTMLElement | null }) {
    window.setTimeout(() => ref.current?.focus(), 0);
  }

  function verificationFailure(cause: unknown): InspectorError {
    return cause instanceof BrowserDossierError
      ? { code: cause.code, stage: cause.stage, message: cause.message }
      : { code: 'UNKNOWN', stage: 'verification', message: cause instanceof Error ? cause.message : 'Local verification failed.' };
  }

  async function inspectFile(file?: File) {
    if (!file) return;
    const run = runGate.current.begin();
    setDossierName(file.name);
    setDossierBytes(undefined);
    setArtifactName('');
    setArtifactError('');
    setBaseResult(undefined);
    setResult(undefined);
    setError(undefined);
    if (file.size > BROWSER_DOSSIER_MAX_BYTES) {
      setError({ code: 'FILE_SIZE', stage: 'file', message: 'Dossier exceeds the 512 KiB browser safety profile.' });
      setResult(undefined);
      setPhase('invalid');
      focus(resultHeading);
      return;
    }
    setPhase('verifying');
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (!runGate.current.isCurrent(run)) return;
      setError({ code: 'FILE_READ', stage: 'file', message: 'The selected dossier could not be read locally.' });
      setPhase('invalid');
      focus(resultHeading);
      return;
    }
    if (!runGate.current.isCurrent(run)) return;
    try {
      const verification = await verifyDossierInBrowser(bytes, { filename: file.name });
      if (!runGate.current.isCurrent(run)) return;
      setDossierBytes(bytes);
      setBaseResult(verification);
      setResult(verification);
      setPhase('valid');
      focus(verdict);
    } catch (cause) {
      if (!runGate.current.isCurrent(run)) return;
      const failure = verificationFailure(cause);
      setResult(undefined);
      setError(failure);
      setPhase('invalid');
      focus(resultHeading);
    }
  }

  async function inspectArtifact(file?: File) {
    if (!file || !dossierBytes) return;
    const run = runGate.current.begin();
    setArtifactName(file.name);
    setArtifactError('');
    if (baseResult) setResult(baseResult);
    if (file.size > BROWSER_ARTIFACT_MAX_BYTES) {
      setArtifactError('Artifact exceeds the 5 MiB browser safety profile.');
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (runGate.current.isCurrent(run)) setArtifactError('The selected artifact could not be read locally.');
      return;
    }
    if (!runGate.current.isCurrent(run)) return;
    try {
      const verification = await verifyDossierInBrowser(dossierBytes, { filename: dossierName, artifactBytes: bytes });
      if (!runGate.current.isCurrent(run)) return;
      setResult(verification);
    } catch (cause) {
      if (!runGate.current.isCurrent(run)) return;
      setArtifactError(cause instanceof BrowserDossierError ? cause.message : 'The artifact comparison could not be completed locally.');
    }
  }

  function reset() {
    runGate.current.cancel();
    setPhase('idle');
    setDossierBytes(undefined);
    setDossierName('');
    setArtifactName('');
    setBaseResult(undefined);
    setResult(undefined);
    setError(undefined);
    setArtifactError('');
    if (dossierInput.current) dossierInput.current.value = '';
    if (artifactInput.current) artifactInput.current.value = '';
    focus(dossierInput);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void inspectFile(event.dataTransfer.files[0]);
  }

  return (
    <section className="proof-inspector" id="inspect" aria-labelledby="inspector-title">
      <div className="inspector-heading">
        <div>
          <p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />LOCAL PROOF INSPECTOR / WEBCRYPTO / NO UPLOAD</p>
          <h2 id="inspector-title">Drop proof.<br /><em>See every binding.</em></h2>
        </div>
        <p>Canonical JSON, SHA-256, Ed25519 signatures, revision links, issuer outcomes, and Commons policy run entirely in this tab. Dossier URLs are never opened or fetched.</p>
      </div>

      <div className="inspector-workbench">
        <div
          className={`inspector-drop${dragging ? ' dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            id="dossier-file"
            ref={dossierInput}
            type="file"
            accept="application/json,.json"
            onChange={(event: ChangeEvent<HTMLInputElement>) => void inspectFile(event.target.files?.[0])}
          />
          <label htmlFor="dossier-file">
            <span aria-hidden="true">↳</span>
            <strong>{dossierName || 'CHOOSE CANONICAL DOSSIER'}</strong>
            <small>or drop one JSON file here · max 512 KiB</small>
          </label>
          <p>Bytes stay in volatile browser memory. No account, vault, API route, resolver, upload, or network request.</p>
        </div>

        <aside className="inspector-boundary" aria-label="Inspector trust boundary">
          <span>WHAT A VALID RESULT MEANS</span>
          <strong>KEY CONTROL + BYTE INTEGRITY</strong>
          <p>It does not prove authorship, correctness, legal identity, payment, reward allocation, or airdrop eligibility.</p>
          <code>COMMONS PROFILE · 64 RECEIPTS · 32 DIDs · DEPTH 64</code>
        </aside>
      </div>

      {phase === 'verifying' && <div className="inspector-status verifying" role="status" aria-live="polite"><span>◌</span><div><strong>VERIFYING LOCALLY</strong><p>Hashing canonical bytes and checking bounded signature jobs…</p></div></div>}

      {phase === 'invalid' && error && <div className="inspector-status invalid" role="alert">
        <span>×</span><div><p>{error.stage.toUpperCase()} / {error.code}</p><h3 ref={resultHeading} tabIndex={-1}>Dossier not verified.</h3><p>{error.message}</p><button className="button button-secondary" type="button" onClick={reset}>Choose another dossier</button></div>
      </div>}

      {phase === 'valid' && result && <div className="inspector-result">
        <header
          className="inspector-verdict"
          ref={verdict}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`Dossier verified. ${result.layers.artifact === 'mismatch' ? 'Supplied artifact mismatch.' : 'Signatures and hash links valid.'} Mission ${result.mission.title}.`}
        >
          <div><p>LOCAL VERDICT / {result.layers.artifact === 'mismatch' ? 'ARTIFACT MISMATCH' : 'CRYPTOGRAPHICALLY VALID'}</p><h3 ref={resultHeading} tabIndex={-1}><bdi dir="auto">{result.mission.title}</bdi></h3><span><bdi dir="auto">{result.mission.lane}</bdi> · {result.mission.id} · {result.selectedState.toUpperCase()}</span></div>
          <div className={result.layers.artifact === 'mismatch' ? 'invalid' : 'valid'}><span>{result.layers.artifact === 'mismatch' ? '!' : '✓'}</span><strong>{result.layers.artifact === 'mismatch' ? 'DOSSIER VALID' : 'VALID'}</strong><small>{result.layers.artifact === 'mismatch' ? 'SUPPLIED ARTIFACT DOES NOT MATCH' : 'SIGNATURES + HASH LINKS'}</small></div>
        </header>

        <div className="inspector-metrics" aria-label="Verified dossier summary">
          <article><span>DOSSIER</span><strong>{result.id}</strong></article>
          <article><span>REVISIONS</span><strong>{String(result.revisionCount).padStart(2, '0')}</strong></article>
          <article><span>RECEIPTS</span><strong>{String(result.receiptCount).padStart(2, '0')}</strong></article>
          <article><span>COMMONS CONTENT PROFILE</span><strong className={result.commons.eligible ? 'good' : 'muted'}>{result.commons.eligible ? 'SATISFIED' : 'NOT SATISFIED'}</strong></article>
        </div>

        <div className="inspector-proof-layout">
          <section aria-labelledby="layer-title">
            <div className="inspector-section-label"><span>01</span><h4 id="layer-title">Independent proof layers</h4></div>
            <dl className="inspector-layers">{layerLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={stateClass(result.layers[key])}>{stateLabel(result.layers[key])}</dd></div>)}</dl>
          </section>

          <section aria-labelledby="chain-title">
            <div className="inspector-section-label"><span>02</span><h4 id="chain-title">Signed revision path</h4></div>
            <ol className="inspector-chain">
              <li><span>MISSION</span><strong>{result.mission.id}</strong><code>{compactDid(result.mission.issuerDid)}</code></li>
              <li><span>CLAIM</span><strong>{compactDid(result.mission.claimantDid)}</strong><code>REQUIREMENTS HASH BOUND</code></li>
              {result.revisions.map((revision) => <li key={revision.resultId}><span>REVISION {String(revision.revision).padStart(2, '0')}</span><strong>{revision.resultId}</strong><code>{revision.outcome.toUpperCase()} · {revision.resultReceiptSha256.slice(0, 28)}…</code></li>)}
            </ol>
          </section>
        </div>

        <div className="inspector-gap-layout">
          <section aria-labelledby="gap-title">
            <div className="inspector-section-label"><span>03</span><h4 id="gap-title">Proof gap report</h4></div>
            {result.gaps.length ? <ul className="inspector-gaps">{result.gaps.map((gap) => {
              const copy = gapCopy[gap] ?? ['INSPECT GAP', gap];
              return <li key={gap}><span>○</span><div><strong>{copy[0]}</strong><p>{copy[1]}</p></div></li>;
            })}</ul> : <div className="inspector-complete"><span>✓</span><p>Every optional proof layer represented by this profile is present.</p></div>}
          </section>

          <section className="inspector-artifact" aria-labelledby="artifact-title">
            <div className="inspector-section-label"><span>04</span><h4 id="artifact-title">Artifact byte check</h4></div>
            <p>Dossier validity does not require downloading an artifact. If you possess the exact file, compare it locally.</p>
            <input id="artifact-file" ref={artifactInput} type="file" onChange={(event) => void inspectArtifact(event.target.files?.[0])} />
            <label className="button button-secondary" htmlFor="artifact-file">{artifactName || 'Choose artifact · max 5 MiB'}</label>
            {artifactError && <p className="form-error" role="alert">{artifactError}</p>}
            {result.layers.artifact !== 'not_checked' && !artifactError && <p className={result.layers.artifact === 'valid' ? 'good' : 'form-error'} role="status" aria-live="polite">Artifact check: {result.layers.artifact === 'valid' ? 'MATCH' : 'MISMATCH'}.</p>}
          </section>
        </div>

        <div className="inspector-footer">
          <div><span>COMMONS CONTENT PROFILE</span><strong className={result.commons.eligible ? 'good' : 'muted'}>{result.commons.eligible ? 'CONTENT SATISFIED' : 'CONTENT NOT READY'}</strong><p>{result.commons.reason} CI remains authoritative for the Git path, regular-file mode, and one-dossier PR boundary.</p></div>
          <div><span>CANONICAL SHA-256</span><code>{result.sha256}</code><button type="button" onClick={reset}>Inspect another dossier</button></div>
        </div>
      </div>}
    </section>
  );
}
