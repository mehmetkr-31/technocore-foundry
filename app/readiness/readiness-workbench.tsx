'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createVault,
  downloadVault,
  parseVault,
  signTechnocoreMessage,
  signTechnocoreNote,
  unlockVault,
  type FoundryVault,
} from '@/lib/foundry-crypto';
import {
  loadReadinessLedger,
  recordReadinessMessage,
  saveReadinessLedger,
  type ReadinessLedger,
} from '@/lib/readiness-storage';
import {
  createSignedParticipationBundle,
  verifySignedParticipationBundle,
} from '@/lib/participation-bundle';
import { ownedTechnocoreRoom, privateTechnocoreMailbox } from '@/lib/technocore-contract';
import { TECHNOCORE_ADAPTER_VERSION, TECHNOCORE_IDLE_SECONDS, TECHNOCORE_STILLBORN_SECONDS } from '@/lib/technocore-contract';
import {
  verifyTechnocoreExport,
  verifyTechnocoreRecordProof,
  type TechnocoreExportVerification,
  type TechnocoreRecordProof,
} from '@/lib/technocore-records';
import { decodeStrictUtf8, parseStrictJson } from '@/lib/strict-json';
import { loadVault, saveVault } from '@/lib/vault-storage';

type LiveStatus = {
  state: 'compatible' | 'incompatible' | 'offline';
  supportedVersion: string;
  liveVersion: string | null;
  supportedCommit: string;
  openapiMatch: boolean;
  configMatch: boolean;
  agentMatch: boolean;
  writesEnabled: boolean;
  reason: string;
};

type ProfileState = { fingerprint: string; namespace: string; key: string; exists: boolean; value: string | null };
type NoteState = { exists: boolean; value: string | null };
type RoomState = { exists: boolean; room: string; generation: number | null; lastSeq: number; latestTimestamp: string | null };
type OwnershipState = { room: string; owner: NoteState; allow: NoteState; nonce: NoteState; roomState: RoomState };

const CONFIRMATION = 'publish_to_technocore';

function compactDid(did: string) {
  return `${did.slice(0, 20)}…${did.slice(-12)}`;
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(value?.error ?? `Request failed with ${response.status}.`);
  if (!value) throw new Error('The local adapter returned no JSON response.');
  return value;
}

function formValue(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) ?? '');
}

function dueLabel(timestamp: string, hours: number) {
  const remaining = Date.parse(timestamp) + hours * 60 * 60 * 1000 - Date.now();
  if (remaining <= 0) return 'OVERDUE — verify upstream before writing';
  const remainingHours = Math.ceil(remaining / (60 * 60 * 1000));
  return remainingHours < 48 ? `${remainingHours}h remaining` : `${Math.ceil(remainingHours / 24)}d remaining`;
}

function randomMailbox() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `mb-p-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export default function ReadinessWorkbench() {
  const [vault, setVault] = useState<FoundryVault>();
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<LiveStatus>();
  const [ledger, setLedger] = useState<ReadinessLedger>();
  const [backupFile, setBackupFile] = useState('');
  const [profile, setProfile] = useState<ProfileState>();
  const [profileDraft, setProfileDraft] = useState('');
  const [roomName, setRoomName] = useState('d-');
  const [mailboxName, setMailboxName] = useState('');
  const [ownership, setOwnership] = useState<OwnershipState>();
  const [exportRoom, setExportRoom] = useState('lobby');
  const [exportReport, setExportReport] = useState<TechnocoreExportVerification>();
  const [proofValid, setProofValid] = useState<boolean>();
  const [bundleValid, setBundleValid] = useState<boolean>();
  const [lastProof, setLastProof] = useState<TechnocoreRecordProof>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadVault()
      .then((stored) => {
        setVault(stored);
        if (stored) {
          const storedLedger = loadReadinessLedger(stored.did);
          setLedger(storedLedger);
          setMailboxName(storedLedger.mailbox ?? randomMailbox());
        }
      })
      .catch(() => setError('Local vault storage is unavailable in this browser.'))
      .finally(() => setLoaded(true));
    refreshLive().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!vault) return;
    fetch(`/api/technocore/readiness?kind=profile&did=${encodeURIComponent(vault.did)}`, { cache: 'no-store' })
      .then((response) => responseJson<ProfileState>(response))
      .then((state) => {
        setProfile(state);
        setProfileDraft(state.value ?? '');
      })
      .catch(() => undefined);
  }, [vault]);

  async function refreshLive() {
    try {
      const status = await responseJson<LiveStatus>(await fetch('/api/technocore/readiness?kind=status', { cache: 'no-store' }));
      setLive(status);
    } catch (cause) {
      setLive({
        state: 'offline', supportedVersion: TECHNOCORE_ADAPTER_VERSION, liveVersion: null, supportedCommit: '',
        openapiMatch: false, configMatch: false, agentMatch: false, writesEnabled: false,
        reason: cause instanceof Error ? cause.message : 'Live protocol check failed.',
      });
    }
  }

  async function refreshProfile(did = vault?.did) {
    if (!did) return;
    const state = await responseJson<ProfileState>(await fetch(`/api/technocore/readiness?kind=profile&did=${encodeURIComponent(did)}`, { cache: 'no-store' }));
    setProfile(state);
    setProfileDraft(state.value ?? '');
  }

  async function refreshOwnership(candidate = roomName) {
    const room = ownedTechnocoreRoom(candidate);
    setRoomName(room);
    const state = await responseJson<OwnershipState>(await fetch(`/api/technocore/readiness?kind=ownership&room=${encodeURIComponent(room)}`, { cache: 'no-store' }));
    setOwnership(state);
    return state;
  }

  function keepLedger(next: ReadinessLedger) {
    setLedger(next);
    saveReadinessLedger(next);
  }

  async function forgeIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy('identity'); setError(''); setNotice('');
    try {
      const passphrase = formValue(form, 'passphrase');
      if (passphrase !== formValue(form, 'confirmation')) throw new Error('Passphrase confirmation does not match.');
      const next = await createVault(passphrase);
      await unlockVault(next, passphrase);
      await saveVault(next);
      downloadVault(next);
      setVault(next);
      setLedger(loadReadinessLedger(next.did));
      setMailboxName(randomMailbox());
      form.reset();
      setNotice('DID created, key-pair self-test passed, and encrypted backup downloaded. Complete the file restore drill next.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity could not be created.');
    } finally { setBusy(''); }
  }

  async function verifyBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vault || !ledger) return;
    setBusy('backup'); setError(''); setNotice('');
    try {
      const recovered = parseVault(parseStrictJson(backupFile));
      await unlockVault(recovered, formValue(form, 'passphrase'));
      if (recovered.did !== vault.did) throw new Error('The backup is valid, but it belongs to a different DID. The active vault was not changed.');
      const next = { ...ledger, backupVerifiedAt: new Date().toISOString() };
      keepLedger(next);
      form.reset(); setBackupFile('');
      setNotice('Downloaded backup restored successfully and resolved to the active DID.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backup drill failed. The active vault was not changed.');
    } finally { setBusy(''); }
  }

  async function publishMessage(room: string, text: string, passphrase: string) {
    if (!vault || !ledger) throw new Error('Create or restore a local DID first.');
    if (!live?.writesEnabled) throw new Error(live?.reason ?? 'Live protocol compatibility has not been established.');
    const nonceState = await responseJson<{ room: string; did: string; generation: number | null; nonce: string | null }>(
      await fetch(`/api/technocore/readiness?kind=message_nonce&room=${encodeURIComponent(room)}&did=${encodeURIComponent(vault.did)}`, { cache: 'no-store' }),
    );
    const signed = await signTechnocoreMessage(vault, passphrase, room, text, nonceState.nonce ?? undefined);
    let response: { status: 'published'; proof: TechnocoreRecordProof };
    try {
      response = await responseJson(await fetch('/api/technocore/readiness', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish_message', confirmation: CONFIRMATION, message: signed }),
      }));
    } catch (cause) {
      downloadJson(`${room}-nonce-${signed.nonce}.unconfirmed-technocore-attempt.json`, {
        schema: 'foundry-technocore-unconfirmed-attempt-v1',
        capturedAt: new Date().toISOString(),
        message: signed,
        warning: 'This file proves only what was signed. Inspect a fresh room export for the exact signature before deciding whether to sign another message.',
      });
      throw new Error(`${cause instanceof Error ? cause.message : 'Publication failed.'} An unconfirmed signed-attempt file was downloaded; inspect the room export before retrying.`);
    }
    setLastProof(response.proof);
    downloadJson(`${room}-seq-${response.proof.record.seq}.technocore-proof.json`, response.proof);
    const next = recordReadinessMessage(ledger, {
      room,
      sequence: String(response.proof.record.seq),
      generation: response.proof.generation,
      publishedAt: response.proof.capturedAt,
    });
    setLedger(next);
    return response.proof;
  }

  async function submitIntroduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy('intro'); setError(''); setNotice('');
    try {
      if (formValue(form, 'confirm') !== 'yes') throw new Error('Confirm the irreversible public write first.');
      const proof = await publishMessage('lobby', formValue(form, 'text'), formValue(form, 'passphrase'));
      form.reset();
      setNotice(`Lobby introduction accepted as sequence ${proof.record.seq}; portable author-signature proof downloaded.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Introduction could not be published.'); }
    finally { setBusy(''); }
  }

  async function publishProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vault || !ledger) return;
    setBusy('profile'); setError(''); setNotice('');
    try {
      if (!live?.writesEnabled) throw new Error(live?.reason ?? 'Protocol compatibility is unverified.');
      if (formValue(event.currentTarget, 'confirm') !== 'yes') throw new Error('Confirm that this profile note is public and world-writable.');
      await responseJson<{ status: string; value: string }>(await fetch('/api/technocore/readiness', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish_profile', confirmation: CONFIRMATION, did: vault.did,
          value: profileDraft, previousValue: profile?.exists ? profile.value : null,
        }),
      }));
      const next = { ...ledger, profilePublishedAt: new Date().toISOString() };
      keepLedger(next);
      await refreshProfile();
      setNotice(`Profile routing hint published. It is unsigned metadata, not proof of DID ownership.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Profile note could not be published.'); }
    finally { setBusy(''); }
  }

  async function claimRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vault) return;
    setBusy('claim-room'); setError(''); setNotice('');
    try {
      if (!live?.writesEnabled) throw new Error(live?.reason ?? 'Protocol compatibility is unverified.');
      if (formValue(form, 'confirm') !== 'yes') throw new Error('Confirm the public ownership write first.');
      const room = formValue(form, 'room');
      const passphrase = formValue(form, 'passphrase');
      const state = await refreshOwnership(room);
      if (state.owner.exists) throw new Error('This room already has an owner.');
      if (state.roomState.lastSeq > 0) throw new Error('This room already has messages and can no longer be claimed.');
      const note = await signTechnocoreNote(vault, passphrase, 'room-owners', state.room, vault.did, state.nonce.value ?? undefined);
      await responseJson(await fetch('/api/technocore/readiness', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish_signed_note', confirmation: CONFIRMATION, operation: 'claim', note }),
      }));
      await refreshOwnership(state.room);
      form.reset();
      setNotice(`${state.room} ownership claimed. The room does not exist until its first signed message is posted.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Room could not be claimed.'); }
    finally { setBusy(''); }
  }

  async function publishOwnedRoomMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy('room-message'); setError(''); setNotice('');
    try {
      if (!ownership) throw new Error('Inspect an owned room first.');
      if (formValue(form, 'confirm') !== 'yes') throw new Error('Confirm the irreversible public write first.');
      const proof = await publishMessage(ownership.room, formValue(form, 'text'), formValue(form, 'passphrase'));
      await refreshOwnership(ownership.room);
      form.reset();
      setNotice(`Meaningful room message accepted as sequence ${proof.record.seq}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Room message could not be published.'); }
    finally { setBusy(''); }
  }

  async function publishMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vault) return;
    setBusy('mailbox'); setError(''); setNotice('');
    try {
      if (formValue(form, 'confirm') !== 'yes') throw new Error('Confirm the irreversible public mailbox write first.');
      const room = privateTechnocoreMailbox(formValue(form, 'mailbox'));
      const proof = await publishMessage(room, formValue(form, 'text'), formValue(form, 'passphrase'));
      const current = loadReadinessLedger(vault.did);
      keepLedger({ ...current, mailbox: room });
      form.reset();
      setMailboxName(room);
      setNotice(`Signed mailbox created as ${room}, sequence ${proof.record.seq}. Its name is a capability, not encryption.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mailbox could not be created.'); }
    finally { setBusy(''); }
  }

  async function exportParticipationBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vault || !ledger) return;
    setBusy('bundle'); setError(''); setNotice('');
    try {
      const envelope = await createSignedParticipationBundle({
        vault,
        passphrase: formValue(form, 'passphrase'),
        contributionType: formValue(form, 'contributionType'),
        contributionUrl: formValue(form, 'contributionUrl'),
        contributionSummary: formValue(form, 'contributionSummary'),
        profilePath: profile ? `/kv/${profile.namespace}/${profile.key}` : null,
        profileValue: profile?.value ?? null,
        mailbox: ledger.mailbox,
        activity: ledger.messages,
        portableProofs: lastProof ? [lastProof] : [],
      });
      downloadJson(`technocore-participation-${envelope.bundle.fingerprint}.json`, envelope);
      form.reset();
      setNotice('DID-signed public participation bundle downloaded. It contains no private key and makes no eligibility claim.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Participation bundle could not be created.'); }
    finally { setBusy(''); }
  }

  async function inspectBundle(file: File | undefined) {
    setBundleValid(undefined); setError('');
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Participation bundle exceeds 1 MiB.');
      const value = parseStrictJson(decodeStrictUtf8(await file.arrayBuffer()));
      setBundleValid(await verifySignedParticipationBundle(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Participation bundle could not be read.');
      setBundleValid(false);
    }
  }

  async function updateOwnedRoom(event: FormEvent<HTMLFormElement>, operation: 'allow' | 'transfer') {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vault || !ownership) return;
    setBusy(operation); setError(''); setNotice('');
    try {
      if (ownership.owner.value !== vault.did) throw new Error('Only the current room owner can perform this operation.');
      if (formValue(form, 'confirm') !== 'yes') throw new Error('Confirm the irreversible public ownership change first.');
      const namespace = operation === 'allow' ? 'room-allow' : 'room-owners';
      const raw = formValue(form, operation === 'allow' ? 'allowList' : 'nextOwner');
      const value = operation === 'allow' ? raw.split(/\s+/).filter(Boolean).join(' ') : raw.trim();
      const note = await signTechnocoreNote(vault, formValue(form, 'passphrase'), namespace, ownership.room, value, ownership.nonce.value ?? undefined);
      await responseJson(await fetch('/api/technocore/readiness', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish_signed_note', confirmation: CONFIRMATION, operation, note }),
      }));
      await refreshOwnership(ownership.room);
      form.reset();
      setNotice(operation === 'allow' ? 'Room allow-list updated.' : 'Room ownership transferred. Review the old allow-list separately.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Owned-room update failed.'); }
    finally { setBusy(''); }
  }

  async function inspectRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('inspect-room'); setError('');
    try { await refreshOwnership(formValue(event.currentTarget, 'room')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Room state could not be read.'); }
    finally { setBusy(''); }
  }

  async function inspectExport(file: File | undefined) {
    setExportReport(undefined); setError('');
    if (!file) return;
    try { setExportReport(await verifyTechnocoreExport(await file.arrayBuffer(), exportRoom)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Export verification failed.'); }
  }

  async function inspectProof(file: File | undefined) {
    setProofValid(undefined); setError('');
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('Proof file exceeds 256 KiB.');
      const value = parseStrictJson(decodeStrictUtf8(await file.arrayBuffer()));
      setProofValid(await verifyTechnocoreRecordProof(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Record proof could not be read.');
      setProofValid(false);
    }
  }

  const readiness = useMemo(() => ({
    identity: Boolean(vault),
    backup: Boolean(ledger?.backupVerifiedAt),
    intro: Boolean(ledger?.messages.some((message) => message.room === 'lobby')),
    profile: Boolean(ledger?.profilePublishedAt),
    mailbox: Boolean(ledger?.mailbox),
  }), [vault, ledger]);

  const reminders = useMemo(() => {
    if (!ledger) return [] as Array<{ label: string; detail: string }>;
    const latest = new Map<string, typeof ledger.messages[number]>();
    ledger.messages.forEach((message) => latest.set(message.room, message));
    const output = Array.from(latest.values()).filter((message) => message.room.startsWith('d-') || message.room.startsWith('mb-')).map((message) => ({
      label: message.room,
      detail: `${message.sequence === '1' ? 'Second meaningful message' : 'Meaningful refresh'} · ${dueLabel(message.publishedAt, (message.sequence === '1' ? TECHNOCORE_STILLBORN_SECONDS : TECHNOCORE_IDLE_SECONDS) / 3600)}`,
    }));
    if (ledger.profilePublishedAt) output.push({ label: 'DID profile note', detail: `Refresh only if still useful · ${dueLabel(ledger.profilePublishedAt, TECHNOCORE_IDLE_SECONDS / 3600)}` });
    return output;
  }, [ledger]);

  return <>
    <header className="readiness-hero">
      <div>
        <p className="eyebrow"><span className="pulse-dot" />OPERATOR READINESS / LOCAL-FIRST</p>
        <h1>Ready for the protocol.<br /><em>Not the hype.</em></h1>
        <p>Secure one identity, publish only meaningful work, keep portable proof, and let upstream changes arrive as reviewable updates—not silent breakage.</p>
      </div>
      <aside className="readiness-status" aria-live="polite">
        <span>LIVE ADAPTER GATE</span>
        <strong>TECHNOCORE v{live?.supportedVersion ?? TECHNOCORE_ADAPTER_VERSION}</strong>
        <i className={live?.state === 'compatible' ? 'good' : 'bad'}>{live?.state === 'compatible' ? '● COMPATIBLE / WRITES AVAILABLE' : live ? `○ ${live.state.toUpperCase()} / WRITES BLOCKED` : '○ CHECKING LIVE CONTRACT'}</i>
        <small>{live?.reason ?? 'Comparing the live version and OpenAPI digest with the reviewed adapter.'}</small>
        <button className="button button-secondary" type="button" onClick={() => refreshLive()} disabled={busy !== ''}>Recheck live protocol</button>
      </aside>
    </header>

    {(notice || error) && <div className={`readiness-banner ${error ? 'invalid' : 'valid'}`} role="status">{error || notice}<button type="button" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}

    <section className="readiness-progress" aria-label="Readiness summary">
      <article><span>IDENTITY</span><strong>{readiness.identity ? 'READY' : 'REQUIRED'}</strong></article>
      <article><span>BACKUP DRILL</span><strong>{readiness.backup ? 'VERIFIED' : 'PENDING'}</strong></article>
      <article><span>LOBBY PROOF</span><strong>{readiness.intro ? 'CAPTURED' : 'PENDING'}</strong></article>
      <article><span>PROFILE NOTE</span><strong>{readiness.profile ? 'SEEN' : 'OPTIONAL'}</strong></article>
      <article><span>MAILBOX</span><strong>{readiness.mailbox ? 'CREATED' : 'OPTIONAL'}</strong></article>
      <article><span>TESTNET</span><strong>SPEC PENDING</strong></article>
    </section>

    <section className="readiness-workflow">
      <article className="readiness-panel identity-panel">
        <div className="panel-heading"><span>01 / IDENTITY CUSTODY</span><h2>One DID. A tested way back.</h2><p>The initial key-pair self-test and the downloaded-file restore drill are separate checks.</p></div>
        {loaded && vault ? <div className="identity-ready"><span>ACTIVE DEVICE IDENTITY</span><code>{vault.did}</code><div className="readiness-actions"><button className="button button-secondary" type="button" onClick={() => downloadVault(vault)}>Download encrypted backup</button><Link className="button button-secondary" href="/">Switch identity in Foundry</Link></div></div> : <form onSubmit={forgeIdentity} className="readiness-form"><label>Passphrase · minimum 12 characters<input name="passphrase" type="password" minLength={12} autoComplete="new-password" required /></label><label>Confirm passphrase<input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label><button className="button button-primary" disabled={busy !== ''}>{busy === 'identity' ? 'Creating…' : 'Create DID + download backup'}</button><p>Already have a Foundry vault? Restore it from the main identity control.</p><p><strong>Existing encrypted PEM?</strong> Do not create a second DID. Use the local <code>foundry-signer import-pem</code> command documented in Local operations, then restore the resulting vault.</p></form>}
        {vault && ledger && <form onSubmit={verifyBackup} className="readiness-form drill-form"><h3>Downloaded-backup recovery drill</h3><label>Encrypted vault file<input type="file" accept="application/json,.json" required onChange={(event) => { const file = event.target.files?.[0]; setBackupFile(''); if (file && file.size <= 32 * 1024) file.arrayBuffer().then(decodeStrictUtf8).then(setBackupFile).catch(() => setError('Backup must be strict UTF-8 JSON.')); else if (file) setError('Backup file exceeds 32 KiB.'); }} /></label><label>Backup passphrase<input name="passphrase" type="password" autoComplete="current-password" required /></label><button className="button button-primary" disabled={!backupFile || busy !== ''}>{busy === 'backup' ? 'Testing…' : ledger.backupVerifiedAt ? 'Repeat restore drill' : 'Verify downloaded backup'}</button>{ledger.backupVerifiedAt && <small>Last successful drill: {ledger.backupVerifiedAt}</small>}</form>}
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>02 / SIGNED INTRODUCTION</span><h2>Introduce useful intent once.</h2><p>No canned “GM” message. Foundry reads the retained per-room nonce, signs the exact swept text locally, posts only after confirmation, and returns a portable author-signature proof.</p></div>
        <form onSubmit={submitIntroduction} className="readiness-form"><label>Unique lobby introduction<textarea name="text" minLength={24} maxLength={4096} rows={5} placeholder="I am building … for …; the useful result will be …" required /></label><label>Unlock local vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> I understand this is an irreversible public write.</label><button className="button button-primary" disabled={!vault || !live?.writesEnabled || busy !== ''}>{busy === 'intro' ? 'Signing + publishing…' : 'Sign, publish, download proof'}</button></form>
        {lastProof && <div className="proof-result"><strong>AUTHOR SIGNATURE VALID</strong><span>room {lastProof.room} · seq {lastProof.record.seq} · generation {lastProof.generation}</span><small>Sequence, timestamp, generation, and server inclusion are not covered by the DID signature.</small></div>}
      </article>

      <article className="readiness-panel wide-panel">
        <div className="panel-heading"><span>03 / PORTABLE TRANSPORT PROOF</span><h2>Keep the bytes the ring forgets.</h2><p>Download current retained JSONL through a fixed-origin read-only bridge, then verify every author signature offline. A 19-digit nonce never passes through a JavaScript float.</p></div>
        <div className="proof-tools"><div className="readiness-form"><label>Room name<input value={exportRoom} onChange={(event) => setExportRoom(event.target.value)} pattern="[a-z0-9][a-z0-9_-]{0,47}" required /></label><a className="button button-secondary" href={`/api/technocore/readiness?kind=export&room=${encodeURIComponent(exportRoom)}`}>Download retained JSONL</a><label>Verify a JSONL export locally<input type="file" accept="application/x-ndjson,.jsonl,text/plain" onChange={(event) => inspectExport(event.target.files?.[0])} /></label></div><div className="readiness-form"><label>Verify a downloaded record proof<input type="file" accept="application/json,.json" onChange={(event) => inspectProof(event.target.files?.[0])} /></label>{proofValid !== undefined && <div className={`verify-banner ${proofValid ? 'valid' : 'invalid'}`}>{proofValid ? '● VALID AUTHOR SIGNATURE' : '○ INVALID RECORD PROOF'}<small>Server inclusion remains outside the signature.</small></div>}</div></div>
        {exportReport && <div className="export-report"><div><span>FILE SHA-256</span><code>{exportReport.sha256}</code></div><div className="export-counts"><strong>{exportReport.counts.valid} valid</strong><span>{exportReport.counts.not_reverifiable} legacy</span><span>{exportReport.counts.unsigned} unsigned</span><b>{exportReport.counts.invalid} invalid</b></div><p>{exportReport.records.length} records · {exportReport.bytes} bytes · seq/ts/generation are unsigned server metadata.</p>{exportReport.records.slice(0, 8).map((record) => <small key={`${record.line}-${record.seq}`}>#{record.line} · seq {record.seq} · {record.signatureState.replace('_', ' ')} · {compactDid(record.from)}</small>)}</div>}
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>04 / PROFILE ROUTING HINT</span><h2>Discoverable, never mistaken for proof.</h2><p>The DID profile note is unsigned and world-writable. Foundry uses compare-and-set to avoid silently overwriting a changed note.</p></div>
        {vault ? <form onSubmit={publishProfile} className="readiness-form"><label>Profile note<textarea rows={4} maxLength={8192} value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} placeholder="What this agent builds, how to contact it, and where its proofs live." required /></label>{profile && <code>/kv/{profile.namespace}/{profile.key}</code>}<label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Publish this world-readable, world-writable routing hint.</label><div className="readiness-actions"><button className="button button-primary" disabled={!live?.writesEnabled || busy !== ''}>{busy === 'profile' ? 'Publishing…' : profile?.exists ? 'Compare + refresh profile' : 'Publish profile'}</button><button className="button button-secondary" type="button" onClick={() => refreshProfile()} disabled={busy !== ''}>Read current</button></div></form> : <p className="empty-copy">Create or restore a DID first.</p>}
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>05 / OWNED ROOM</span><h2>Claim only what you will use.</h2><p>Only a fresh <code>d-</code> room can be claimed. Ownership does not create the room; the first signed message does.</p></div>
        <form onSubmit={inspectRoom} className="readiness-form inline-form"><label>Owned room<input name="room" value={roomName} onChange={(event) => setRoomName(event.target.value)} pattern="d-[a-z0-9_-]+" required /></label><button className="button button-secondary" disabled={busy !== ''}>{busy === 'inspect-room' ? 'Reading…' : 'Inspect owner + nonce'}</button></form>
        {ownership && <div className="ownership-state"><span>OWNER <b>{ownership.owner.value ? compactDid(ownership.owner.value) : 'UNCLAIMED'}</b></span><span>NONCE <b>{ownership.nonce.value ?? 'NONE'}</b></span><span>ROOM <b>{ownership.roomState.exists ? `GEN ${ownership.roomState.generation} / SEQ ${ownership.roomState.lastSeq}` : 'NOT CREATED'}</b></span><span>ALLOW <b>{ownership.allow.value ? ownership.allow.value.split(/\s+/).length : 0}</b></span></div>}
        {(!ownership || !ownership.owner.exists) && <form onSubmit={claimRoom} className="readiness-form"><label>Room to claim<input name="room" defaultValue={roomName} pattern="d-[a-z0-9_-]+" required /></label><label>Unlock owner vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Claim this public room under my active DID.</label><button className="button button-primary" disabled={!vault || !live?.writesEnabled || busy !== ''}>{busy === 'claim-room' ? 'Signing + claiming…' : 'Claim fresh d- room'}</button></form>}
        {ownership?.owner.exists && <details className="owned-room-tools"><summary>Owned-room writes and delegation</summary><form onSubmit={publishOwnedRoomMessage} className="readiness-form"><h3>Meaningful room message</h3><label>Message<textarea name="text" minLength={16} maxLength={4096} rows={4} required /></label><label>Unlock writer vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Publish this message publicly.</label><button className="button button-primary" disabled={!vault || !live?.writesEnabled || busy !== ''}>{busy === 'room-message' ? 'Publishing…' : 'Sign + publish room message'}</button></form><form onSubmit={(event) => updateOwnedRoom(event, 'allow')} className="readiness-form"><h3>Replace allow-list</h3><label>Space or newline-separated DIDs<textarea name="allowList" rows={4} defaultValue={ownership.allow.value ?? ownership.owner.value ?? ''} required /></label><small>To revoke every delegate, publish only the owner DID. The owner can always write independently of this list.</small><label>Unlock owner vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Replace the public allow-list.</label><button className="button button-secondary" disabled={ownership.owner.value !== vault?.did || busy !== ''}>Update allow-list</button></form><form onSubmit={(event) => updateOwnedRoom(event, 'transfer')} className="readiness-form danger-form"><h3>Transfer ownership</h3><label>New owner DID<input name="nextOwner" required /></label><label>Unlock current owner vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Transfer is public and does not clear the old allow-list.</label><button className="button button-secondary" disabled={ownership.owner.value !== vault?.did || busy !== ''}>Sign ownership transfer</button></form></details>}
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>06 / SIGNED MAILBOX</span><h2>Reachable, attributable, not secret.</h2><p>An <code>mb-p-</code> room is unlisted and rejects unsigned writes. Anyone who learns its name can read it, and any valid DID can append a signed message; this is not encryption or an owner-only inbox.</p></div>
        <form onSubmit={publishMailbox} className="readiness-form"><label>Unguessable mailbox room<input name="mailbox" value={mailboxName} onChange={(event) => setMailboxName(event.target.value)} pattern="mb-p-[a-z0-9]{16,40}" required /></label><button className="button button-secondary" type="button" onClick={() => setMailboxName(randomMailbox())}>Rotate draft name</button><label>First meaningful mailbox message<textarea name="text" minLength={16} maxLength={4096} rows={4} defaultValue="This signed mailbox belongs to the DID in this message. Use signed messages and do not send secrets." required /></label><label>Unlock local vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Create this public append-only room with a signed write.</label><button className="button button-primary" disabled={!vault || !live?.writesEnabled || busy !== ''}>{busy === 'mailbox' ? 'Signing + publishing…' : ledger?.mailbox ? 'Publish mailbox refresh' : 'Create signed mailbox + proof'}</button>{ledger?.mailbox && <small>Active routing value: <code>{ledger.mailbox}</code>. Rotating the name does not update the unsigned profile note automatically.</small>}</form>
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>07 / PUBLIC PARTICIPATION BUNDLE</span><h2>One portable file, honest trust labels.</h2><p>The bundle combines your contribution link, routing hints, local acknowledgement metadata, and the latest portable room proof. The whole statement is signed by your DID; it still does not prove airdrop eligibility or offline server inclusion.</p></div>
        <form onSubmit={exportParticipationBundle} className="readiness-form"><label>Contribution type<input name="contributionType" maxLength={32} placeholder="tool, guide, translation…" required /></label><label>Contribution URL<input name="contributionUrl" type="url" placeholder="https://github.com/…" required /></label><label>Contribution summary<textarea name="contributionSummary" minLength={16} maxLength={320} rows={4} required /></label><label>Unlock local vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><button className="button button-primary" disabled={!vault || !ledger || busy !== ''}>{busy === 'bundle' ? 'Signing bundle…' : 'Sign + download public bundle'}</button><small>No ciphertext, passphrase, or private key is exported. Only the most recent in-session record proof is embedded; older downloaded proofs remain separate files.</small></form><div className="readiness-form drill-form"><h3>Offline bundle signature check</h3><label>Signed participation bundle<input type="file" accept="application/json,.json" onChange={(event) => inspectBundle(event.target.files?.[0])} /></label>{bundleValid !== undefined && <div className={`verify-banner ${bundleValid ? 'valid' : 'invalid'}`}>{bundleValid ? '● VALID DID STATEMENT' : '○ INVALID OR MODIFIED BUNDLE'}<small>A valid signature authenticates the DID’s statement, not its eligibility.</small></div>}</div>
      </article>

      <article className="readiness-panel wide-panel future-panel">
        <div className="panel-heading"><span>08 / FUTURE TESTNET ADAPTER</span><h2>Prepared interface. No invented API.</h2><p>The official faucet, wallet binding, inference endpoint, receipt schema, and chain identifiers are not final. Foundry will import signed receipts and show observed spend only after those contracts are published and reviewed.</p></div>
        <div className="future-grid"><span>FAUCET CLAIM<b>BLOCKED ON OFFICIAL SPEC</b></span><span>INFERENCE SPEND<b>BLOCKED ON RECEIPT SCHEMA</b></span><span>UNLOCK LEDGER<b>OBSERVED DATA ONLY</b></span><span>AUTOMATION<b>NO AUTO-CLAIM / NO AUTO-SPEND</b></span></div>
      </article>
    </section>

    {reminders.length > 0 && <section className="readiness-reminders"><div><p className="eyebrow">LOCAL REMINDERS / NEVER AUTO-POST</p><h2>Things that may expire.</h2></div>{reminders.map((reminder) => <article key={reminder.label}><strong>{reminder.label}</strong><span>{reminder.detail}</span></article>)}</section>}

    <aside className="readiness-caveat"><strong>NO AIRDROP SCORE</strong><p>This workbench proves key control and selected message signatures. It cannot predict allocation, prove server inclusion offline, prove eligibility, or turn current room activity into testnet inference spend.</p></aside>
  </>;
}
