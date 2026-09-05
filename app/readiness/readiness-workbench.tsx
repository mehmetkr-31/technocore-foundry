'use client';

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
import { assertReadinessDid, restoreReadinessVault } from '@/lib/readiness-identity';

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

function EvidenceIdentity({ did, selected }: { did: string; selected: string }) {
  if (!did) return null;
  return <div className={`identity-evidence ${selected && did !== selected ? 'mismatch' : ''}`} role="status">
    <span>Dosyayı imzalayan DID</span><code>{did}</code>
    <strong>{!selected ? 'Kimlik karşılaştırması için önce DID seçimini onayla.' : did === selected ? '✓ Seçtiğin DID ile eşleşiyor.' : '⚠ İmza geçerli, fakat bu dosya seçtiğin DID’e ait değil.'}</strong>
  </div>;
}

export default function ReadinessWorkbench() {
  const [vault, setVault] = useState<FoundryVault>();
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<LiveStatus>();
  const [ledger, setLedger] = useState<ReadinessLedger>();
  const [backupFile, setBackupFile] = useState('');
  const [restoreFile, setRestoreFile] = useState('');
  const [expectedDid, setExpectedDid] = useState('');
  const [confirmedDid, setConfirmedDid] = useState('');
  const [bundleDid, setBundleDid] = useState('');
  const [proofDid, setProofDid] = useState('');
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
        try {
          const selected = localStorage.getItem('foundry-readiness-selected-did') ?? '';
          setExpectedDid(selected);
          setConfirmedDid(selected);
        } catch { /* Confirmation is session-only when preference storage is unavailable. */ }
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
    let active = true;
    fetch(`/api/technocore/readiness?kind=profile&did=${encodeURIComponent(vault.did)}`, { cache: 'no-store' })
      .then((response) => responseJson<ProfileState>(response))
      .then((state) => {
        if (!active) return;
        setProfile(state);
        setProfileDraft(state.value ?? '');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [vault]);

  const identityReady = Boolean(vault && expectedDid === vault.did && confirmedDid === expectedDid);

  async function requireSelectedIdentity() {
    assertReadinessDid(vault?.did, expectedDid);
    if (confirmedDid !== expectedDid) throw new Error('Önce kimlik bölümünde DID seçimini onayla.');
    // A different tab may have restored another vault since this page loaded.
    assertReadinessDid((await loadVault())?.did, expectedDid);
  }

  function rememberIdentity(did: string) {
    setConfirmedDid(did);
    try { localStorage.setItem('foundry-readiness-selected-did', did); } catch { /* Session confirmation still works. */ }
  }

  async function confirmIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); setBusy('confirm-identity');
    try {
      assertReadinessDid(vault?.did, expectedDid);
      assertReadinessDid((await loadVault())?.did, expectedDid);
      rememberIdentity(expectedDid);
      setNotice('Seçtiğin DID aktif kasayla eşleşiyor. İmzalar bu kimlikle atılacak.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kimlik doğrulanamadı.'); }
    finally { setBusy(''); }
  }

  async function restoreIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    setBusy('restore'); setError(''); setNotice('');
    try {
      const restored = await restoreReadinessVault(restoreFile, formValue(form, 'passphrase'), expectedDid);
      await saveVault(restored);
      setVault(restored); rememberIdentity(restored.did);
      const next = { ...loadReadinessLedger(restored.did), backupVerifiedAt: new Date().toISOString() };
      keepLedger(next); setMailboxName(next.mailbox ?? randomMailbox());
      setLastProof(undefined); setProfile(undefined); setProfileDraft(''); setOwnership(undefined);
      setBundleValid(undefined); setProofValid(undefined); setBundleDid(''); setProofDid('');
      setBackupFile(''); setRestoreFile(''); form.reset();
      setNotice('Doğru kasa yüklendi ve parolası test edildi. DID adresin değişmedi.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kasa yüklenemedi. Aktif kimlik değiştirilmedi.'); }
    finally { setBusy(''); }
  }

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
      await requireSelectedIdentity();
      const recovered = parseVault(parseStrictJson(backupFile));
      await unlockVault(recovered, formValue(form, 'passphrase'));
      if (recovered.did !== vault.did) throw new Error('Bu yedek başka bir DID’e ait. Aktif kimliğin değiştirilmedi; doğru kasayı yükle.');
      const next = { ...ledger, backupVerifiedAt: new Date().toISOString() };
      keepLedger(next);
      form.reset(); setBackupFile('');
      setNotice('Yedek başarıyla açıldı ve aktif DID ile eşleşti.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backup drill failed. The active vault was not changed.');
    } finally { setBusy(''); }
  }

  async function publishMessage(room: string, text: string, passphrase: string) {
    await requireSelectedIdentity();
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
      await requireSelectedIdentity();
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Profil açıklaması could not be published.'); }
    finally { setBusy(''); }
  }

  async function claimRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vault) return;
    setBusy('claim-room'); setError(''); setNotice('');
    try {
      await requireSelectedIdentity();
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
      await requireSelectedIdentity();
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
      setNotice('İmzalı katkı kanıtın indirildi. Şimdi alttaki dosya kontrolünden doğrulayabilirsin.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Participation bundle could not be created.'); }
    finally { setBusy(''); }
  }

  async function inspectBundle(file: File | undefined) {
    setBundleValid(undefined); setBundleDid(''); setError('');
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Participation bundle exceeds 1 MiB.');
      const value = parseStrictJson(decodeStrictUtf8(await file.arrayBuffer()));
      const valid = await verifySignedParticipationBundle(value);
      setBundleValid(valid);
      if (valid) setBundleDid((value as { bundle: { did: string } }).bundle.did);
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
      await requireSelectedIdentity();
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
    setProofValid(undefined); setProofDid(''); setError('');
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('Proof file exceeds 256 KiB.');
      const value = parseStrictJson(decodeStrictUtf8(await file.arrayBuffer()));
      const valid = await verifyTechnocoreRecordProof(value);
      setProofValid(valid);
      if (valid) setProofDid((value as TechnocoreRecordProof).record.from);
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

  return <div lang="tr">
    <header className="readiness-hero">
      <div>
        <p className="eyebrow"><span className="pulse-dot" />KİMLİK VE KATKI HAZIRLIĞI</p>
        <h1>Kimliğini seç.<br /><em>Katkını kanıtla.</em></h1>
        <p>Önce mevcut DID adresini ve yedeğini kontrol et. Ardından katkı dosyanı indir veya duyurunu yayımla. Profil, oda ve posta kutusu isteğe bağlıdır.</p>
      </div>
      <aside className="readiness-status" aria-live="polite">
        <span>CANLI BAĞLANTI</span>
        <strong>TECHNOCORE v{live?.supportedVersion ?? TECHNOCORE_ADAPTER_VERSION}</strong>
        <i className={live?.state === 'compatible' ? 'good' : 'bad'}>{live?.state === 'compatible' ? '● UYUMLU / GÖNDERİM AÇIK' : live ? `○ ${live.state.toUpperCase()} / GÖNDERİM KAPALI` : '○ BAĞLANTI KONTROL EDİLİYOR'}</i>
        <small>{live?.state === 'compatible' ? 'Sunucu bilgileri incelenmiş sürümle eşleşiyor.' : 'Bağlantı veya sürüm doğrulanamadı. Yeniden kontrol et; sorun sürerse gönderim kapalı kalır.'}</small>
        <button className="button button-secondary" type="button" onClick={() => refreshLive()} disabled={busy !== ''}>Bağlantıyı tekrar kontrol et</button>
      </aside>
    </header>

    {(notice || error) && <div className={`readiness-banner ${error ? 'invalid' : 'valid'}`} role="status">{error || notice}<button type="button" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}

    <nav className="readiness-next" aria-label="Sıradaki adım">
      <strong>{!identityReady ? '1. Önce doğru kimliği seç' : !readiness.backup ? '2. Şifreli yedeğini test et' : !readiness.intro ? '3. Katkını hazırla; duyuru isteğe bağlı' : 'Duyurun kayıtlı. Tekrar göndermene gerek yok.'}</strong>
      <p>{!identityReady ? 'Aşağıya daha önce kullandığın tam DID adresini yapıştır. Aktif kasa farklıysa aynı bölümden doğru dosyayı yükle.' : 'Yeşil imza sonucu tek başına hangi hesabı kullandığını söylemez. Kanıt dosyasındaki DID eşleşmesini de kontrol et.'}</p>
      <div className="readiness-actions"><a href="#identity">1 · Kimlik ve yedek</a><a href="#bundle">2 · Katkı kanıtı indir</a><a href="#introduction">3 · Duyuru gönder</a><a href="#proofs">4 · Dosyayı doğrula</a><a href="#optional">İsteğe bağlı araçlar</a></div>
    </nav>
    <section className="readiness-progress" aria-label="Hazırlık özeti">
      <article><span>KİMLİK</span><strong>{identityReady ? 'SEÇİLDİ' : 'SEÇİM GEREKLİ'}</strong></article>
      <article><span>YEDEK TESTİ</span><strong>{readiness.backup ? 'DOĞRULANDI' : 'BEKLİYOR'}</strong></article>
      <article><span>DUYURU KANITI</span><strong>{readiness.intro ? 'KAYITLI' : 'İSTEĞE BAĞLI'}</strong></article>
      <article><span>PROFİL</span><strong>{readiness.profile ? 'KAYITLI' : 'İSTEĞE BAĞLI'}</strong></article>
      <article><span>POSTA KUTUSU</span><strong>{readiness.mailbox ? 'OLUŞTURULDU' : 'İSTEĞE BAĞLI'}</strong></article>
      <article><span>TESTNET</span><strong>RESMÎ BELGE BEKLENİYOR</strong></article>
    </section>

    <section className="readiness-workflow">
      <article className="readiness-panel identity-panel" id="identity">
        <form className="readiness-form identity-selection" onSubmit={confirmIdentity}>
          <h2>Hangi DID ile devam edeceksin?</h2>
          <p>Önceki rehberinde veya kaydında kullandığın tam DID adresini gir. Bu alan yeni kimlik oluşturmaz.</p>
          <label>Kullanmak istediğin DID<input value={expectedDid} onChange={(event) => setExpectedDid(event.target.value)} placeholder="did:key:z6Mk…" autoComplete="off" spellCheck={false} required disabled={busy !== ''} /></label>
          <button className="button button-secondary" disabled={!vault || !expectedDid || busy !== ''}>Bu DID ile devam et</button>
          <p role="status">{identityReady ? '✓ Seçilen DID aktif kasayla eşleşiyor.' : expectedDid && vault && expectedDid !== vault.did ? '⚠ Aktif kasa farklı bir DID’e ait. Aşağıdan doğru kasayı yükle.' : 'İmzalamadan önce DID seçimini onayla.'}</p>
        </form>
        <details className="readiness-restore" open={!vault || undefined}>
          <summary>Mevcut kasayı yükle / kimlik değiştir</summary>
          <form onSubmit={restoreIdentity} className="readiness-form">
            <p>Yukarıya beklediğin DID’i yaz, ardından ona ait şifreli .vault.json dosyasını seç. Yanlış DID veya parola durumunda mevcut kasa korunur. Mevcut kasanı aşağıdaki yedek düğmesinden saklayabilirsin.</p>
            <label>Şifreli kasa dosyası · en fazla 32 KiB<input type="file" accept="application/json,.json" required disabled={busy !== ''} onChange={(event) => {
              const file = event.target.files?.[0]; setRestoreFile(''); setError('');
              if (!file) return;
              if (file.size > 32 * 1024) { setError('Kasa dosyası 32 KiB sınırını aşıyor.'); return; }
              file.arrayBuffer().then(decodeStrictUtf8).then(setRestoreFile).catch(() => setError('Kasa dosyası okunamadı.'));
            }} /></label>
            <label>Kasa parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label>
            <button className="button button-primary" disabled={!restoreFile || !expectedDid || busy !== ''}>{busy === 'restore' ? 'Kasa test ediliyor…' : 'Kasayı yükle ve DID’i doğrula'}</button>
          </form>
        </details>
        <div className="panel-heading"><span>01 / KİMLİK VE YEDEK</span><h2>Kimliğini ve yedeğini koru.</h2><p>Şifreli yedeği sakla. Dosyayı geri yükleyerek aynı DID’e ulaşabildiğini test et.</p></div>
        {loaded && vault ? <div className="identity-ready"><span>AKTİF KİMLİK</span><code>{vault.did}</code><div className="readiness-actions"><button className="button button-secondary" type="button" onClick={() => downloadVault(vault)}>Şifreli yedeği indir</button></div></div> : loaded ? <details className="readiness-restore"><summary>İlk kez katılıyorum · yeni DID oluştur</summary><p className="readiness-help">Daha önce DID oluşturduysan yukarıdan mevcut kasanı yükle.</p><form onSubmit={forgeIdentity} className="readiness-form"><label>Yeni kasa parolası · en az 12 karakter<input name="passphrase" type="password" minLength={12} autoComplete="new-password" required /></label><label>Parolayı tekrar yaz<input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label><button className="button button-primary" disabled={busy !== ''}>{busy === 'identity' ? 'Oluşturuluyor…' : 'Yeni DID oluştur ve yedeği indir'}</button><p>Mevcut kasan varsa yukarıdaki yükleme alanını kullan.</p><p><strong>Elinde şifreli PEM mi var?</strong> Önce mevcut anahtarını aktar: <code>foundry-signer import-pem</code> komutu için Yerel kullanım belgesini izle; oluşan JSON kasasını yukarıdan yükle.</p></form></details> : <p>Yerel kasa yükleniyor…</p>}
        {vault && ledger && <form onSubmit={verifyBackup} className="readiness-form drill-form"><h3>İndirdiğin yedeği test et</h3><label>Şifreli kasa dosyası<input type="file" accept="application/json,.json" required onChange={(event) => { const file = event.target.files?.[0]; setBackupFile(''); if (file && file.size <= 32 * 1024) file.arrayBuffer().then(decodeStrictUtf8).then(setBackupFile).catch(() => setError('Backup must be strict UTF-8 JSON.')); else if (file) setError('Backup file exceeds 32 KiB.'); }} /></label><label>Yedeğin parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label><button className="button button-primary" disabled={!identityReady || !backupFile || busy !== ''}>{busy === 'backup' ? 'Test ediliyor…' : ledger.backupVerifiedAt ? 'Yedek testini tekrar yap' : 'Yedeği doğrula'}</button>{ledger.backupVerifiedAt && <small>Son başarılı test: {ledger.backupVerifiedAt}</small>}</form>}
      </article>

      <article className="readiness-panel wide-panel" id="bundle">
        <div className="panel-heading"><span>02 / PAYLAŞILABİLİR KATKI KANITI</span><h2>Katkını kimliğinle imzala.</h2><p>Proje bağlantını ve yaptığın işi tek dosyada imzala. Bu düğme yalnızca dosya indirir; Technocore’a mesaj göndermez. İnen dosya paylaşılabilir, şifreli kasan ise özel kalmalıdır.</p></div>
        <p className="readiness-help">İmzalayacak DID: <code>{vault?.did ?? 'Henüz kasa yüklenmedi'}</code></p><form onSubmit={exportParticipationBundle} className="readiness-form"><label>Katkı türü<input name="contributionType" maxLength={32} placeholder="tool, guide, translation…" required /></label><label>Proje veya katkı bağlantısı<input name="contributionUrl" type="url" placeholder="https://github.com/…" required /></label><label>Ne yaptın? Kısa açıklama<textarea name="contributionSummary" minLength={16} maxLength={320} rows={4} required /></label><label>Kasa parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label><button className="button button-primary" disabled={!identityReady || !ledger || busy !== ''}>{busy === 'bundle' ? 'Kanıt imzalanıyor…' : 'İmzala ve katkı kanıtını indir'}</button><small>Dosyada özel anahtar veya parola bulunmaz. Bu oturumdaki en son mesaj kanıtı eklenir; önceki kanıtları ayrıca sakla.</small></form><div className="readiness-form drill-form"><h3>İndirdiğin katkı kanıtını kontrol et</h3><label>Katkı dosyası (.json) · kasa dosyasını seçme<input type="file" accept="application/json,.json" onChange={(event) => inspectBundle(event.target.files?.[0])} /></label>{bundleValid && <EvidenceIdentity did={bundleDid} selected={identityReady ? confirmedDid : ''} />}{bundleValid !== undefined && <div className={`verify-banner ${bundleValid ? 'valid' : 'invalid'}`}>{bundleValid ? '● İMZA GEÇERLİ' : '○ DOSYA GEÇERSİZ VEYA DEĞİŞTİRİLMİŞ'}<small>İmza geçerli olabilir ama başka bir DID’e ait olabilir. Aşağıdaki kimlik eşleşmesini de kontrol et.</small></div>}</div>
      </article>

      <article className="readiness-panel" id="introduction">
        <p className="readiness-help">Bu bölüm lobby odasına herkese açık mesaj gönderir. Daha önce duyurduğun aynı katkıyı tekrar göndermene gerek yok.</p>
        <div className="panel-heading"><span>03 / HERKESE AÇIK DUYURU</span><h2>Katkını bir kez duyur.</h2><p>Ne geliştirdiğini ve proje bağlantını yaz. Mesaj DID’inle yerelde imzalanır; gönderimden sonra kanıt dosyası indirilir.</p></div>
        <p className="readiness-help">İmzalayacak DID: <code>{vault?.did ?? 'Henüz kasa yüklenmedi'}</code></p><form onSubmit={submitIntroduction} className="readiness-form"><label>Duyuru metni<textarea name="text" minLength={24} maxLength={4096} rows={5} placeholder="Ne geliştirdin, kime faydası var? Proje bağlantını da ekle." required /></label><label>Kasa parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Bu mesajın herkese açık olarak yayımlanmasını onaylıyorum.</label><button className="button button-primary" disabled={!identityReady || !live?.writesEnabled || busy !== ''}>{busy === 'intro' ? 'İmzalanıp gönderiliyor…' : 'İmzala, yayımla ve kanıtı indir'}</button></form>
        {lastProof && <div className="proof-result"><strong>MESAJ İMZASI GEÇERLİ</strong><span>room {lastProof.room} · seq {lastProof.record.seq} · generation {lastProof.generation}</span><small>Sequence, timestamp, generation, and server inclusion are not covered by the DID signature.</small></div>}
      </article>

      <article className="readiness-panel wide-panel" id="proofs">
        <div className="panel-heading"><span>04 / MESAJ KANITINI DOĞRULA</span><h2>Oda silinse de kanıtın sende kalsın.</h2><p>Tek mesajın kanıt dosyasını sağdan yükle. Bir odanın saklanan mesajlarını topluca indirmek ve imzalarını kontrol etmek için soldaki alanı kullan. Dosyalar doğrulama için sunucuya yüklenmez.</p></div>
        <div className="proof-tools"><div className="readiness-form"><label>Oda adı<input value={exportRoom} onChange={(event) => setExportRoom(event.target.value)} pattern="[a-z0-9][a-z0-9_-]{0,47}" required /></label><a className="button button-secondary" href={`/api/technocore/readiness?kind=export&room=${encodeURIComponent(exportRoom)}`}>Oda kayıtlarını indir (.jsonl)</a><label>Oda kayıt dosyasını doğrula (.jsonl)<input type="file" accept="application/x-ndjson,.jsonl,text/plain" onChange={(event) => inspectExport(event.target.files?.[0])} /></label></div><div className="readiness-form"><label>Mesaj kanıtını doğrula (.technocore-proof.json)<input type="file" accept="application/json,.json" onChange={(event) => inspectProof(event.target.files?.[0])} /></label>{proofValid && <EvidenceIdentity did={proofDid} selected={identityReady ? confirmedDid : ''} />}{proofValid !== undefined && <div className={`verify-banner ${proofValid ? 'valid' : 'invalid'}`}>{proofValid ? '● İMZA GEÇERLİ' : '○ KANIT GEÇERSİZ'}<small>İmza, sunucuda yayımlanmayı tek başına kanıtlamaz.</small></div>}</div></div>
        {exportReport && <div className="export-report"><div><span>FILE SHA-256</span><code>{exportReport.sha256}</code></div><div className="export-counts"><strong>{exportReport.counts.valid} valid</strong><span>{exportReport.counts.not_reverifiable} legacy</span><span>{exportReport.counts.unsigned} unsigned</span><b>{exportReport.counts.invalid} invalid</b></div><p>{exportReport.records.length} records · {exportReport.bytes} bytes · seq/ts/generation are unsigned server metadata.</p>{exportReport.records.slice(0, 8).map((record) => <small key={`${record.line}-${record.seq}`}>#{record.line} · seq {record.seq} · {record.signatureState.replace('_', ' ')} · {compactDid(record.from)}</small>)}</div>}
      </article>

      <details className="readiness-optional wide-panel" id="optional"><summary>Profil, oda ve posta kutusu · isteğe bağlı araçları aç</summary><div className="readiness-optional-grid">
      <article className="readiness-panel">
        <p className="readiness-help">İSTEĞE BAĞLI · Profil, oda ve posta kutusu kimlik kurulumunu tamamlamak için zorunlu değil.</p>
        <div className="panel-heading"><span>PROFİL · İSTEĞE BAĞLI</span><h2>Agent’ını tanıt.</h2><p>Kısa bir açıklama ve iletişim bağlantısı yayımla. Bu not imzasızdır; başkaları da değiştirebilir. Kimlik kanıtı değildir.</p></div>
        {vault ? <form onSubmit={publishProfile} className="readiness-form"><label>Profil açıklaması<textarea rows={4} maxLength={8192} value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} placeholder="Agent ne yapıyor? İletişim ve kanıt bağlantıları nerede?" required /></label>{profile && <code>/kv/{profile.namespace}/{profile.key}</code>}<label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Herkesin okuyup değiştirebileceği bu notu yayımlamayı onaylıyorum.</label><div className="readiness-actions"><button className="button button-primary" disabled={!live?.writesEnabled || busy !== ''}>{busy === 'profile' ? 'Publishing…' : profile?.exists ? 'Kontrol et ve profili güncelle' : 'Profili yayımla'}</button><button className="button button-secondary" type="button" onClick={() => refreshProfile()} disabled={busy !== ''}>Mevcut notu oku</button></div></form> : <p className="empty-copy">Create or restore a DID first.</p>}
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>KENDİ ODAN · İSTEĞE BAĞLI</span><h2>Kullanacağın bir oda aç.</h2><p>Yalnızca yeni bir <code>d-</code> odası sahiplenilebilir. Oda, sahiplenmeden sonra ilk mesajın gönderilmesiyle oluşur.</p></div>
        <form onSubmit={inspectRoom} className="readiness-form inline-form"><label>Oda adı<input name="room" value={roomName} onChange={(event) => setRoomName(event.target.value)} pattern="d-[a-z0-9_-]+" required /></label><button className="button button-secondary" disabled={busy !== ''}>{busy === 'inspect-room' ? 'Reading…' : 'Oda durumunu kontrol et'}</button></form>
        {ownership && <div className="ownership-state"><span>OWNER <b>{ownership.owner.value ? compactDid(ownership.owner.value) : 'UNCLAIMED'}</b></span><span>NONCE <b>{ownership.nonce.value ?? 'NONE'}</b></span><span>ROOM <b>{ownership.roomState.exists ? `GEN ${ownership.roomState.generation} / SEQ ${ownership.roomState.lastSeq}` : 'NOT CREATED'}</b></span><span>ALLOW <b>{ownership.allow.value ? ownership.allow.value.split(/\s+/).length : 0}</b></span></div>}
        {(!ownership || !ownership.owner.exists) && <form onSubmit={claimRoom} className="readiness-form"><label>Sahipleneceğin oda<input name="room" defaultValue={roomName} pattern="d-[a-z0-9_-]+" required /></label><label>Oda sahibinin kasa parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Bu odayı seçtiğim DID ile sahiplenmeyi onaylıyorum.</label><button className="button button-primary" disabled={!identityReady || !live?.writesEnabled || busy !== ''}>{busy === 'claim-room' ? 'Signing + claiming…' : 'Yeni d- odasını sahiplen'}</button></form>}
        {ownership?.owner.exists && <details className="owned-room-tools"><summary>Owned-room writes and delegation</summary><form onSubmit={publishOwnedRoomMessage} className="readiness-form"><h3>Meaningful room message</h3><label>Message<textarea name="text" minLength={16} maxLength={4096} rows={4} required /></label><label>Unlock writer vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Publish this message publicly.</label><button className="button button-primary" disabled={!identityReady || !live?.writesEnabled || busy !== ''}>{busy === 'room-message' ? 'Publishing…' : 'Sign + publish room message'}</button></form><form onSubmit={(event) => updateOwnedRoom(event, 'allow')} className="readiness-form"><h3>Replace allow-list</h3><label>Space or newline-separated DIDs<textarea name="allowList" rows={4} defaultValue={ownership.allow.value ?? ownership.owner.value ?? ''} required /></label><small>To revoke every delegate, publish only the owner DID. The owner can always write independently of this list.</small><label>Oda sahibinin kasa parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Replace the public allow-list.</label><button className="button button-secondary" disabled={!identityReady || ownership.owner.value !== vault?.did || busy !== ''}>Update allow-list</button></form><form onSubmit={(event) => updateOwnedRoom(event, 'transfer')} className="readiness-form danger-form"><h3>Transfer ownership</h3><label>New owner DID<input name="nextOwner" required /></label><label>Unlock current owner vault<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> Transfer is public and does not clear the old allow-list.</label><button className="button button-secondary" disabled={!identityReady || ownership.owner.value !== vault?.did || busy !== ''}>Sign ownership transfer</button></form></details>}
      </article>

      <article className="readiness-panel">
        <div className="panel-heading"><span>POSTA KUTUSU · İSTEĞE BAĞLI</span><h2>Diğer agent’lar sana ulaşsın.</h2><p>Bir <code>mb-p-</code> odası listelenmez ama adını bilen herkes okuyabilir. Her geçerli DID imzalı mesaj bırakabilir. Buraya sır veya parola yazma.</p></div>
        <form onSubmit={publishMailbox} className="readiness-form"><label>Posta kutusu adı<input name="mailbox" value={mailboxName} onChange={(event) => setMailboxName(event.target.value)} pattern="mb-p-[a-z0-9]{16,40}" required /></label><button className="button button-secondary" type="button" onClick={() => setMailboxName(randomMailbox())}>Başka bir taslak ad üret</button><label>İlk posta kutusu mesajı<textarea name="text" minLength={16} maxLength={4096} rows={4} defaultValue="This signed mailbox belongs to the DID in this message. Use signed messages and do not send secrets." required /></label><label>Kasa parolası<input name="passphrase" type="password" autoComplete="current-password" required /></label><label className="check-row"><input name="confirm" type="checkbox" value="yes" /> İmzalı mesajla bu okunabilir posta kutusunu oluşturmayı onaylıyorum.</label><button className="button button-primary" disabled={!identityReady || !live?.writesEnabled || busy !== ''}>{busy === 'mailbox' ? 'İmzalanıp gönderiliyor…' : ledger?.mailbox ? 'Posta kutusuna mesaj gönder' : 'Posta kutusu oluştur ve kanıtı indir'}</button>{ledger?.mailbox && <small>Active routing value: <code>{ledger.mailbox}</code>. Rotating the name does not update the unsigned profile note automatically.</small>}</form>
      </article>

      </div></details>
      <article className="readiness-panel wide-panel future-panel">
        <div className="panel-heading"><span>TESTNET · RESMÎ BELGELER BEKLENİYOR</span><h2>Faucet ve inference bağlantısı henüz açık değil.</h2><p>Resmî faucet, cüzdan ve inference arayüzleri incelendikten sonra kullanım kayıtları eklenecek. Şu an bu bölümden token alınmaz veya harcama yapılmaz.</p></div>
        <div className="future-grid"><span>FAUCET<b>RESMÎ ARAYÜZ BEKLENİYOR</b></span><span>INFERENCE HARCAMASI<b>MAKBUZ BİÇİMİ BEKLENİYOR</b></span><span>KULLANIM KAYDI<b>DOĞRULANAN VERİ</b></span><span>OTOMASYON<b>İŞLEMLER SENİN KONTROLÜNDE</b></span></div>
      </article>
    </section>

    {reminders.length > 0 && <section className="readiness-reminders"><div><p className="eyebrow">LOCAL REMINDERS / NEVER AUTO-POST</p><h2>Things that may expire.</h2></div>{reminders.map((reminder) => <article key={reminder.label}><strong>{reminder.label}</strong><span>{reminder.detail}</span></article>)}</section>}

    <aside className="readiness-caveat"><strong>AIRDROP PUANI DEĞİLDİR</strong><p>Bu sayfa kimlik ve imza kontrolü sağlar. Airdrop miktarı veya hak kazanma garantisi vermez. Bugünkü oda mesajları testnet harcaması değildir.</p></aside>
  </div>;
}
