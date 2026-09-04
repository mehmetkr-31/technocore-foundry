'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import {
  BrowserTclkError,
  inspectTclkTechnocoreExport,
  inspectTclkTranscript,
  TCLK_TRANSCRIPT_MAX_BYTES,
  type BrowserTclkInspection,
} from '@/lib/browser-tclk-inspector.mjs';
import { TECHNOCORE_EXPORT_MAX_BYTES } from '@/lib/technocore-records';
import { TCLK_OPERATIONAL_COMMIT } from '@/lib/tclk-contract';

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
  const transcriptInput = useRef<HTMLInputElement>(null);
  const exportInput = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [exportName, setExportName] = useState('');
  const [exportRoom, setExportRoom] = useState('');
  const [mode, setMode] = useState<'raw' | 'export'>('raw');
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
    setMode('raw');
    setExportName('');
    if (exportInput.current) exportInput.current.value = '';
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
    setMode('raw');
    setName(file.name);
    setExportName('');
    setResult(undefined);
    if (exportInput.current) exportInput.current.value = '';
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

  async function readTechnocoreExport(file?: File) {
    if (!file) return;
    setMode('export');
    setExportName(file.name);
    setName('');
    setSource('');
    setError(undefined);
    setResult(undefined);
    if (transcriptInput.current) transcriptInput.current.value = '';
    if (file.size > TECHNOCORE_EXPORT_MAX_BYTES) {
      setError({ code: 'FILE_SIZE', stage: 'transport', message: 'Technocore export exceeds the 16 MiB local verification limit.' });
      setPhase('invalid');
      focusResult();
      return;
    }
    setPhase('checking');
    try {
      const inspected = await inspectTclkTechnocoreExport(new Uint8Array(await file.arrayBuffer()), exportRoom);
      setSource(inspected.transport?.records.map((record) => record.text).join('\n') ?? '');
      setResult(inspected);
      setPhase('ready');
    } catch (cause) {
      setError(failure(cause));
      setPhase('invalid');
    }
    focusResult();
  }

  function invalidateResult() {
    setPhase('idle');
    setResult(undefined);
    setError(undefined);
  }

  function reset() {
    setSource(''); setName(''); setExportName(''); setPhase('idle'); setResult(undefined); setError(undefined);
    if (transcriptInput.current) transcriptInput.current.value = '';
    if (exportInput.current) exportInput.current.value = '';
  }

  return <section className="tclk-inspector" aria-labelledby="tclk-inspector-title">
    <div className="tclk-workbench">
      <div>
        <p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />OFFLINE TRANSCRIPT INSPECTOR / ZERO FETCH / ZERO POST</p>
        <h2 id="tclk-inspector-title">Read the deal.<br /><em>Keep the boundary.</em></h2>
        <p>Paste canonical <code>tclk1</code> frames, or load a real Technocore JSONL room export and verify every selected author signature locally. These bytes stay in volatile browser memory and are never posted, signed, stored, or sent to a settlement rail.</p>
      </div>
      <aside className="tclk-boundary">
        <span>THIS INSPECTOR DOES NOT PROVE</span>
        <strong>SERVER INCLUSION · PAYMENT · WORK QUALITY · REWARD</strong>
        <p>A JSONL export can bind room, nonce, and text to each author DID. Its seq, ts, and generation metadata are not signed, and the copied file is not a server-inclusion proof.</p>
        <code>tclk/1 · upstream {TCLK_OPERATIONAL_COMMIT.slice(0, 7)}</code>
      </aside>
    </div>

    <div className="tclk-input-grid">
      <label className="tclk-textarea-label" htmlFor="tclk-frames">PATH A / RAW ORDERED tclk1 FRAMES</label>
      <textarea id="tclk-frames" value={source} onChange={(event) => { setSource(event.target.value); setName(''); setExportName(''); setMode('raw'); if (exportInput.current) exportInput.current.value = ''; invalidateResult(); }} placeholder={'tclk1 {"amount":"…",…}\ntclk1 {"contract":"…",…}'} spellCheck={false} rows={9} />
      <div className="tclk-actions">
        <button className="button" type="button" onClick={() => void inspect()}>Inspect locally →</button>
        <input ref={transcriptInput} id="tclk-file" type="file" accept="text/plain,.txt" onChange={(event: ChangeEvent<HTMLInputElement>) => void readFile(event.target.files?.[0])} />
        <label className="button button-secondary" htmlFor="tclk-file">{name || 'Choose transcript · max 256 KiB'}</label>
      </div>
      <label className="tclk-textarea-label" htmlFor="tclk-export-room">PATH B / SIGNED TECHNOCORE JSONL EXPORT · EXACT SOURCE ROOM REQUIRED</label>
      <textarea id="tclk-export-room" aria-label="Technocore room name" value={exportRoom} onChange={(event) => { setExportRoom(event.target.value); setExportName(''); if (mode === 'export') setSource(''); if (exportInput.current) exportInput.current.value = ''; invalidateResult(); }} placeholder="exact-room-name" spellCheck={false} rows={1} />
      <div className="tclk-actions">
        <input ref={exportInput} id="tclk-export-file" type="file" accept="application/x-ndjson,application/json,text/plain,.jsonl" onChange={(event: ChangeEvent<HTMLInputElement>) => void readTechnocoreExport(event.target.files?.[0])} />
        <label className="button button-secondary" htmlFor="tclk-export-file">{exportName || 'Verify room export · max 16 MiB'}</label>
        {(phase !== 'idle' || source || name || exportName) && <button className="tclk-clear" type="button" onClick={reset}>Clear volatile bytes</button>}
      </div>
    </div>

    {phase === 'checking' && <div className="tclk-status" role="status" aria-live="polite"><span>◌</span><div><strong>CHECKING LOCALLY</strong><p>{mode === 'export' ? 'Verifying Technocore DID signatures, selecting signed tclk1 records, and replaying one contract…' : 'Parsing strict JSON, recomputing canonical IDs, and replaying one contract…'}</p></div></div>}
    {phase === 'invalid' && error && <div className="tclk-status invalid" role="alert"><span>×</span><div><p>{error.stage.toUpperCase()} / {error.code}</p><h3 ref={resultHeading} tabIndex={-1}>Transcript not verified.</h3><p>{error.message}</p></div></div>}

    {phase === 'ready' && result && <div className="tclk-result">
      <header className="tclk-verdict">
        <div><p>LOCAL TRANSCRIPT STATE / {result.ok ? 'FRAME CHAIN CONSISTENT' : 'INVALID TRANSITION PRESENT'}</p><h3 ref={resultHeading} tabIndex={-1}>{result.status.toUpperCase()}</h3><span>{result.frameCount} FRAME{result.frameCount === 1 ? '' : 'S'} · CONTRACT {compact(result.contract)} · {result.transport ? 'SIGNED EXPORT' : 'RAW INPUT'}</span></div>
        <div className={result.ok && result.layers.transportDid !== 'invalid' ? '' : 'invalid'}><span aria-hidden="true">{result.ok && result.layers.transportDid !== 'invalid' ? '✓' : '×'}</span><strong>{!result.ok ? 'DO NOT RELY ON THIS CHAIN' : result.layers.transportDid === 'invalid' ? 'AUTHOR BINDING FAILED' : result.transport ? 'SIGNED AUTHORS + FRAMES' : 'RAW FRAMES CONSISTENT'}</strong><small>{result.transport ? 'Server inclusion and settlement remain unverified.' : 'Transport and settlement remain unverified.'}</small></div>
      </header>

      {result.transport && <div className={`tclk-status${result.transport.authorsBound ? '' : ' invalid'}`}>
        <span aria-hidden="true">{result.transport.authorsBound ? '✓' : '×'}</span>
        <div>
          <p>TECHNOCORE AUTHOR SIGNATURE LAYER / {result.transport.authorsBound ? 'BOUND' : 'MISMATCH'}</p>
          <h3>{result.transport.selectedRecords} signed tclk1 record{result.transport.selectedRecords === 1 ? '' : 's'} selected.</h3>
          <p>{result.transport.ignoredRecords} unsigned, invalid, legacy-unverifiable, or non-tclk1 record{result.transport.ignoredRecords === 1 ? '' : 's'} ignored. Room <code>{result.transport.room}</code> · export <code>{compact(result.transport.exportSha256)}</code>.</p>
          <p><strong>Signature coverage:</strong> room + nonce + text only. Replay follows JSONL order; <code>seq</code> and <code>ts</code> are unsigned server assertions. <code>X-Room-Generation</code> is an unsigned response header absent from JSONL. A copied export does not cryptographically prove server inclusion.</p>
        </div>
      </div>}

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
