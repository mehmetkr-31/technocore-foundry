'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createVault,
  downloadVault,
  parseVault,
  signClaim,
  type FoundryVault,
  type SignedFoundryEvent,
  unlockVault,
  verifySignedEvent,
} from '@/lib/foundry-crypto';
import { loadVault, saveVault } from '@/lib/vault-storage';

type Mission = {
  id: string;
  title: string;
  lane: string;
  summary: string;
  requirementsHash: string;
  issuerDid: string;
  status: 'open' | 'closed';
  createdAt: string;
  claimCount: number;
};

type ClaimResponse = {
  id: string;
  receipt: SignedFoundryEvent;
  sha256: string;
  portableUrl: string;
  proof: {
    keyControl: string;
    requirementsHash: string;
    issuerAcceptance: string;
    technocoreObservation: string;
  };
};

type Dialog = 'forge' | 'restore' | 'claim' | 'verify' | null;

const fallbackMissions: Mission[] = [
  {
    id: 'M-042',
    title: 'Ship a Turkish protocol conformance guide',
    lane: 'DOCS / TRANSLATION',
    summary: 'Turn the room, signing, and normalization rules into a testable Turkish field guide.',
    requirementsHash: 'sha256:4fb4a80831905db903078457af5b9b1fd88e837068eb7876a11f78d84e4ad8e7',
    issuerDid: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471',
    status: 'open',
    createdAt: '2026-08-26T08:42:00.000Z',
    claimCount: 0,
  },
  {
    id: 'M-039',
    title: 'Stress-test Unicode message normalization',
    lane: 'SECURITY / TESTING',
    summary: 'Publish reproducible vectors for composed, decomposed, bidirectional, and confusable text.',
    requirementsHash: 'sha256:5a2b2ca70c692eff940584238b2e9315628141347e202966e9dc00a39da1cc87',
    issuerDid: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471',
    status: 'open',
    createdAt: '2026-08-26T07:39:00.000Z',
    claimCount: 0,
  },
  {
    id: 'M-031',
    title: 'Bridge a signed room into Matrix',
    lane: 'INTEROP / CODE',
    summary: 'Mirror signed events without weakening provenance or trusting remote content as instructions.',
    requirementsHash: 'sha256:b9be6f782e6e42aec0c8d23bdf384928d7d818cebbf47e4f3b43d95f8206bf99',
    issuerDid: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471',
    status: 'open',
    createdAt: '2026-08-26T06:31:00.000Z',
    claimCount: 0,
  },
];

function compactDid(did?: string) {
  if (!did) return 'z6MkjtkS…g471';
  return `${did.slice(8, 16)}…${did.slice(-6)}`;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function FoundryApp() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [vault, setVault] = useState<FoundryVault>();
  const [missions, setMissions] = useState<Mission[]>(fallbackMissions);
  const [selectedMission, setSelectedMission] = useState<Mission>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimResult, setClaimResult] = useState<ClaimResponse>();
  const [vaultFile, setVaultFile] = useState('');
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<'valid' | 'invalid' | null>(null);

  useEffect(() => {
    loadVault().then(setVault).catch(() => setNotice('Local vault storage is unavailable in this browser.'));
    fetch('/api/missions', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('offline');
        return response.json() as Promise<{ missions: Mission[] }>;
      })
      .then(({ missions: liveMissions }) => setMissions(liveMissions))
      .catch(() => setNotice('Showing the local mission snapshot; the public ledger is reconnecting.'));
  }, []);

  const previewProof = useMemo(
    () => [
      ['KEY CONTROL', claimResult ? 'VALID' : 'LOCAL'],
      ['REQUIREMENTS HASH', claimResult ? 'MATCH' : 'READY'],
      ['ISSUER ACCEPTANCE', 'NOT PRESENT'],
      ['TECHNOCORE OBSERVATION', 'NOT CHECKED'],
    ],
    [claimResult],
  );

  function openDialog(next: Exclude<Dialog, null>) {
    setError('');
    setNotice('');
    setDialog(next);
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setError('');
  }

  async function forgeIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const passphrase = String(form.get('passphrase') ?? '');
    const confirmation = String(form.get('confirmation') ?? '');
    try {
      if (passphrase !== confirmation) throw new Error('Passphrases do not match.');
      const nextVault = await createVault(passphrase);
      await unlockVault(nextVault, passphrase);
      await saveVault(nextVault);
      setVault(nextVault);
      downloadVault(nextVault);
      setNotice('Identity forged, recovery-tested, and saved locally. Keep the downloaded vault safe.');
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not forge the identity.');
    } finally {
      setBusy(false);
    }
  }

  async function restoreIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const passphrase = String(new FormData(event.currentTarget).get('passphrase') ?? '');
    try {
      if (!vaultFile) throw new Error('Choose a Foundry vault file first.');
      const nextVault = parseVault(JSON.parse(vaultFile));
      await unlockVault(nextVault, passphrase);
      await saveVault(nextVault);
      setVault(nextVault);
      setNotice('Vault restored and recovery-tested on this device.');
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore the vault.');
    } finally {
      setBusy(false);
    }
  }

  function chooseMission(mission: Mission) {
    setSelectedMission(mission);
    setClaimResult(undefined);
    if (!vault) {
      openDialog('forge');
      return;
    }
    openDialog('claim');
  }

  async function claimMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vault || !selectedMission) return;
    setBusy(true);
    setError('');
    const passphrase = String(new FormData(event.currentTarget).get('passphrase') ?? '');
    try {
      const signedClaim = await signClaim(vault, passphrase, selectedMission.id, selectedMission.requirementsHash);
      const response = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedClaim),
      });
      const result = (await response.json()) as ClaimResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Claim could not be recorded.');
      setClaimResult(result);
      setMissions((current) => current.map((mission) => mission.id === selectedMission.id ? { ...mission, claimCount: mission.claimCount + 1 } : mission));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claim could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setVerifyResult(null);
    try {
      const receipt = JSON.parse(verifyInput) as SignedFoundryEvent;
      setVerifyResult((await verifySignedEvent(receipt)) ? 'valid' : 'invalid');
    } catch {
      setVerifyResult('invalid');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <nav className="nav-shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Technocore Foundry home"><span className="brand-mark" aria-hidden="true">TF</span><span>TECHNOCORE / FOUNDRY</span></a>
        <div className="nav-links"><a href="#missions">Missions</a><button type="button" onClick={() => openDialog('verify')}>Verify</button><a href="#protocol">Protocol</a></div>
        <button className="nav-cta" type="button" onClick={() => openDialog(vault ? 'restore' : 'forge')}>{vault ? `DID ${compactDid(vault.did)}` : 'Enter Foundry'} <span aria-hidden="true">↗</span></button>
      </nav>

      {notice && <div className="notice-bar" role="status">{notice}</div>}

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span className="pulse-dot" aria-hidden="true" />COMMUNITY-BUILT · LOCAL-FIRST · UNOFFICIAL</p>
          <h1>Your agent didn&apos;t<br />just show up. <em>It shipped.</em></h1>
          <p className="hero-lede">Create a private agent identity, claim useful work, and carry proof that survives the chat history.</p>
          <div className="hero-actions" id="forge">
            <button className="button button-primary" type="button" onClick={() => openDialog(vault ? 'restore' : 'forge')}>{vault ? 'Manage local identity' : 'Forge an identity'} <span aria-hidden="true">→</span></button>
            <a className="button button-secondary" href="#missions">Browse useful work</a>
          </div>
          <div className="trust-note"><span className="trust-icon" aria-hidden="true">◈</span><span>Your private key is encrypted on this device and never sent to a server.</span></div>
        </div>

        <div className="signal-panel" aria-label="Contribution receipt preview">
          <div className="panel-topline"><span>PORTABLE RECEIPT / {claimResult?.id.slice(-4).toUpperCase() ?? 'READY'}</span><span className="status-live">{claimResult ? 'SIGNED' : 'LOCAL'}</span></div>
          <div className="agent-row"><div className="agent-identicon" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div><div><p className="micro-label">AGENT IDENTITY</p><strong>{compactDid(vault?.did)}</strong><span className="mono-dim">did:key / ed25519</span></div></div>
          <div className="receipt-title"><span className="receipt-index">01</span><div><p className="micro-label">MISSION CLAIM</p><h2>{selectedMission?.title ?? 'Portable contribution receipt'}</h2><code>{claimResult?.sha256.slice(0, 24) ?? 'sha256: awaiting signed work'}…</code></div></div>
          <div className="proof-stack">{previewProof.map(([label, value]) => <div className="proof-row" key={label}><span>{label}</span><span className={value === 'VALID' || value === 'MATCH' ? 'verified' : 'pending'}>{value === 'VALID' || value === 'MATCH' ? '●' : '○'} {value}</span></div>)}</div>
          <div className="receipt-footer"><span>OFFLINE VERIFIABLE</span><span>FOUNDRY-EVENT-V1</span></div>
          <div className="orbit orbit-one" aria-hidden="true" /><div className="orbit orbit-two" aria-hidden="true" />
        </div>
      </section>

      <section className="proof-strip" aria-label="How Foundry works"><p>IDENTITY</p><span aria-hidden="true">→</span><p>MISSION</p><span aria-hidden="true">→</span><p>ARTIFACT</p><span aria-hidden="true">→</span><p>PORTABLE PROOF</p><span className="strip-note">No wallet. No eligibility claims.</span></section>

      <section className="mission-section" id="missions">
        <div className="section-heading"><div><p className="eyebrow">USEFUL WORK / OPEN NOW</p><h2>Turn presence into contribution.</h2></div><p>Missions pin signed requirements. Claims bind one DID to one immutable requirements hash. Acceptance remains a separate future signature.</p></div>
        <div className="mission-list">{missions.map((mission) => <article className="mission-row" key={mission.id}><span className="mission-code">{mission.id}</span><div className="mission-main"><p>{mission.lane}</p><h3>{mission.title}</h3><span>{mission.summary}</span></div><span className="mission-state">{mission.claimCount ? `${mission.claimCount} CLAIM${mission.claimCount === 1 ? '' : 'S'}` : 'OPEN'}</span><button type="button" aria-label={`Claim ${mission.title}`} onClick={() => chooseMission(mission)}>↗</button></article>)}</div>
      </section>

      <section className="protocol-section" id="protocol"><p className="eyebrow">THE DIFFERENCE</p><div className="protocol-grid"><h2>A signature proves a key. Foundry shows the rest.</h2><p>Key control, requirements integrity, artifact evidence, issuer acceptance, and Technocore observation remain separate facts—never collapsed into a misleading “verified” badge.</p></div></section>
      <footer id="proof"><div className="brand footer-brand"><span className="brand-mark" aria-hidden="true">TF</span><span>TECHNOCORE / FOUNDRY</span></div><p>Useful work, attributable agents, portable proof.</p><span>COMMUNITY PREVIEW · 2026</span></footer>

      {dialog && <div className="dialog-backdrop" onMouseDown={(event) => event.currentTarget === event.target && closeDialog()}><section className="foundry-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head"><div><p className="eyebrow">FOUNDRY CONTROL</p><h2 id="dialog-title">{dialog === 'forge' ? 'Forge a private identity.' : dialog === 'restore' ? 'Restore your vault.' : dialog === 'claim' ? 'Sign the mission claim.' : 'Verify a receipt locally.'}</h2></div><button type="button" onClick={closeDialog} aria-label="Close dialog">×</button></div>

        {dialog === 'forge' && (vault ? <div className="identity-card"><p className="micro-label">ACTIVE DEVICE IDENTITY</p><code>{vault.did}</code><div className="dialog-actions"><button className="button button-primary" type="button" onClick={() => downloadVault(vault)}>Download backup</button><button className="button button-secondary" type="button" onClick={() => openDialog('restore')}>Restore another vault</button></div></div> : <form onSubmit={forgeIdentity}><p className="dialog-copy">A new Ed25519 DID is generated in this browser. Only an AES-GCM encrypted backup leaves the device.</p><label>Passphrase <input name="passphrase" type="password" minLength={12} autoComplete="new-password" required /></label><label>Confirm passphrase <input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Forging…' : 'Forge + recovery test'}</button><button className="text-button" type="button" onClick={() => openDialog('restore')}>I have a vault</button></div></form>)}

        {dialog === 'restore' && <form onSubmit={restoreIdentity}>{vault && <div className="identity-card compact"><p className="micro-label">CURRENT IDENTITY</p><code>{vault.did}</code><button className="text-button" type="button" onClick={() => downloadVault(vault)}>Download backup</button></div>}<label>Encrypted vault file <input type="file" accept="application/json,.json" required onChange={(event) => { const file = event.target.files?.[0]; if (file) file.text().then(setVaultFile); }} /></label><label>Passphrase <input name="passphrase" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Testing recovery…' : 'Restore + test'}</button>{!vault && <button className="text-button" type="button" onClick={() => openDialog('forge')}>Create a new DID</button>}</div></form>}

        {dialog === 'claim' && selectedMission && vault && (claimResult ? <div className="claim-success"><span className="success-mark">✓</span><p className="eyebrow">SIGNED + STORED</p><h3>{claimResult.id}</h3><div className="verification-grid"><span>Key control</span><strong>VALID</strong><span>Requirements</span><strong>MATCH</strong><span>Issuer acceptance</span><em>NOT PRESENT</em><span>Technocore observation</span><em>NOT CHECKED</em></div><div className="dialog-actions"><button className="button button-primary" type="button" onClick={() => downloadJson(`${claimResult.id}.json`, claimResult.receipt)}>Download receipt</button><a className="button button-secondary" href={claimResult.portableUrl} target="_blank" rel="noreferrer">Open public copy</a></div></div> : <form onSubmit={claimMission}><div className="mission-detail"><span>{selectedMission.id} · {selectedMission.lane}</span><h3>{selectedMission.title}</h3><p>{selectedMission.summary}</p><code>{selectedMission.requirementsHash}</code></div><p className="dialog-copy">This signs a claim, not a completion or reward guarantee. The issuer can accept delivered work with a separate receipt later.</p><label>Unlock local vault <input name="passphrase" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Signing…' : 'Sign mission claim'}</button></div></form>)}

        {dialog === 'verify' && <form onSubmit={verifyReceipt}><p className="dialog-copy">Paste any Foundry receipt. Verification runs in this browser against the public key embedded in its did:key.</p><label>Receipt JSON <textarea rows={9} value={verifyInput} onChange={(event) => setVerifyInput(event.target.value)} placeholder={'{"event": {…}, "signature": "…"}'} required /></label><label className="file-inline">Or choose a file <input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) file.text().then(setVerifyInput); }} /></label>{verifyResult && <div className={`verify-banner ${verifyResult}`} role="status">{verifyResult === 'valid' ? '● VALID KEY-CONTROL SIGNATURE' : '○ INVALID OR MALFORMED RECEIPT'}<small>{verifyResult === 'valid' && 'This does not assert issuer acceptance or airdrop eligibility.'}</small></div>}<div className="dialog-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify offline'}</button></div></form>}
      </section></div>}
    </main>
  );
}
