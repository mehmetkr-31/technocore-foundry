'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import {
  BrowserTclkError,
  inspectTclkTranscript,
  TCLK_TRANSCRIPT_MAX_BYTES,
  type BrowserTclkInspection,
} from '@/lib/browser-tclk-inspector.mjs';

type Failure = { code: string; stage: string; message: string };

const layerLabels: Array<[keyof BrowserTclkInspection['layers'], string]> = [
  ['canonicalFrames', 'CANONICAL FRAME BYTES'],
  ['offerBinding', 'OFFER ID BINDING'],
  ['contractBinding', 'CONTRACT ID BINDING'],
  ['frameOrder', 'PARTY + FRAME ORDER'],
  ['hashWitness', 'HASH WITNESS'],
  ['terminalReceipt', 'TERMINAL RECEIPT'],
  ['transportDid', 'TECHNOCORE TRANSPORT DID'],
  ['deadlineEvidence', 'SIGNED TIME EVIDENCE'],
  ['railSettlement', 'SETTLEMENT RAIL'],
];

function stateLabel(state: string) {
  return state === 'valid' ? 'VALID' : state === 'invalid' ? 'INVALID' : state === 'absent' ? 'ABSENT' : 'NOT CHECKED';
}

function stateClass(state: string) {
  return state === 'valid' ? 'good' : state === 'invalid' ? 'bad' : 'muted';
}

function compact(value: string | null) {
  return value ? `${value.slice(0, 14)}…${value.slice(-10)}` : 'NOT DERIVED';
}

export function TclkInspector() {
  const input = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<'idle' | 'checking' | 'ready' | 'invalid'>('idle');
  const [result, setResult] = useState<BrowserTclkInspection>();
  const [error, setError] = useState<Failure>();

  function focusResult() {
    window.setTimeout(() => resultHeading.current?.focus(), 0);
  }

  function failure(cause: unknown): Failure {
    return cause instanceof BrowserTclkError
      ? { code: cause.code, stage: cause.stage, message: cause.message }
      : { code: 'UNKNOWN', stage: 'inspection', message: cause instanceof Error ? cause.message : 'Local transcript inspection failed.' };
  }

  async function inspect(text = source) {
    setError(undefined);
    setResult(undefined);
    if (!text.trim()) {
      setPhase('invalid');
      setError({ code: 'EMPTY', stage: 'input', message: 'Paste or choose at least one canonical tclk1 frame.' });
      focusResult();
      return;
    }
    setPhase('checking');
    try {
      const inspected = await inspectTclkTranscript(new TextEncoder().encode(text));
      setResult(inspected);
      setPhase('ready');
    } catch (cause) {
      setError(failure(cause));
      setPhase('invalid');
    }
    focusResult();
  }

  async function readFile(file?: File) {
    if (!file) return;
    setName(file.name);
    if (file.size > TCLK_TRANSCRIPT_MAX_BYTES) {
      setError({ code: 'FILE_SIZE', stage: 'file', message: 'Transcript exceeds the 256 KiB local safety profile.' });
      setPhase('invalid');
      focusResult();
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      await inspect(text);
    } catch {
      setError({ code: 'FILE_READ', stage: 'file', message: 'The selected transcript could not be read locally.' });
      setPhase('invalid');
      focusResult();
    }
  }

  function reset() {
    setSource(''); setName(''); setPhase('idle'); setResult(undefined); setError(undefined);
    if (input.current) input.current.value = '';
  }

  return <section className="tclk-inspector" aria-labelledby="tclk-inspector-title">
    <div className="tclk-workbench">
      <div>
        <p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />OFFLINE TRANSCRIPT INSPECTOR / ZERO FETCH / ZERO POST</p>
        <h2 id="tclk-inspector-title">Read the deal.<br /><em>Keep the boundary.</em></h2>
        <p>Paste one ordered deal transcript: one canonical ASCII <code>tclk1</code> frame per line. These bytes stay in volatile browser memory and are never posted, signed, stored, or sent to a settlement rail.</p>
      </div>
      <aside className="tclk-boundary">
        <span>THIS INSPECTOR DOES NOT PROVE</span>
        <strong>PAYMENT · WORK QUALITY · IDENTITY · REWARD</strong>
        <p>Raw room-frame text lacks an independently verifiable transport signature, signed timestamp, and rail receipt. Those layers stay explicitly unverified.</p>
        <code>tclk/1 · upstream 81a8346</code>
      </aside>
    </div>

    <div className="tclk-input-grid">
      <label className="tclk-textarea-label" htmlFor="tclk-frames">ORDERED tclk1 FRAMES</label>
      <textarea id="tclk-frames" value={source} onChange={(event) => setSource(event.target.value)} placeholder={'tclk1 {"amount":"…",…}\ntclk1 {"contract":"…",…}'} spellCheck={false} rows={9} />
      <div className="tclk-actions">
        <button className="button" type="button" onClick={() => void inspect()}>Inspect locally →</button>
        <input ref={input} id="tclk-file" type="file" accept="text/plain,.txt,.jsonl" onChange={(event: ChangeEvent<HTMLInputElement>) => void readFile(event.target.files?.[0])} />
        <label className="button button-secondary" htmlFor="tclk-file">{name || 'Choose transcript · max 256 KiB'}</label>
        {(phase !== 'idle') && <button className="tclk-clear" type="button" onClick={reset}>Clear volatile bytes</button>}
      </div>
    </div>

    {phase === 'checking' && <div className="tclk-status" role="status" aria-live="polite"><span>◌</span><div><strong>CHECKING LOCALLY</strong><p>Parsing strict JSON, recomputing canonical IDs, and replaying one contract…</p></div></div>}
    {phase === 'invalid' && error && <div className="tclk-status invalid" role="alert"><span>×</span><div><p>{error.stage.toUpperCase()} / {error.code}</p><h3 ref={resultHeading} tabIndex={-1}>Transcript not verified.</h3><p>{error.message}</p></div></div>}

    {phase === 'ready' && result && <div className="tclk-result">
      <header className="tclk-verdict">
        <div><p>LOCAL TRANSCRIPT STATE / {result.ok ? 'FRAME CHAIN CONSISTENT' : 'INVALID TRANSITION PRESENT'}</p><h3 ref={resultHeading} tabIndex={-1}>{result.status.toUpperCase()}</h3><span>{result.frameCount} FRAME{result.frameCount === 1 ? '' : 'S'} · CONTRACT {compact(result.contract)}</span></div>
        <div className={result.ok ? '' : 'invalid'}><span aria-hidden="true">{result.ok ? '✓' : '×'}</span><strong>{result.ok ? 'RAW FRAMES CONSISTENT' : 'DO NOT RELY ON THIS CHAIN'}</strong><small>Transport and settlement remain unverified.</small></div>
      </header>

      <div className="tclk-metrics">
        <article><span>LOCK KIND</span><strong>{result.offer.lock.toUpperCase()}</strong></article>
        <article><span>AMOUNT / ASSET</span><strong>{result.offer.amount} {result.offer.asset}</strong></article>
        <article><span>OFFERED RAILS</span><strong>{result.offer.rails.join(', ')}</strong></article>
        <article><span>JOB REFERENCE</span><strong>{result.offer.job ? `${result.offer.job.proto}:${result.offer.job.id}` : 'NOT ATTACHED'}</strong></article>
      </div>

      <div className="tclk-details">
        <section><div className="inspector-section-label"><span>01</span><h4>Independent layers</h4></div><dl className="inspector-layers">{layerLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={stateClass(result.layers[key])}>{stateLabel(result.layers[key])}</dd></div>)}</dl></section>
        <section><div className="inspector-section-label"><span>02</span><h4>Replay timeline</h4></div><ol className="tclk-timeline">{result.events.map((event) => <li key={event.index} className={event.state}><span>{String(event.index).padStart(2, '0')}</span><strong>{event.type.toUpperCase()}</strong><p>{event.message}</p></li>)}</ol></section>
      </div>
      <section className="tclk-caveats"><div className="inspector-section-label"><span>03</span><h4>Proof boundary</h4></div><ul>{result.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></section>
    </div>}
  </section>;
}
