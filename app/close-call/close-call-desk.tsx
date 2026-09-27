'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { loadVault, saveVault } from '@/lib/vault-storage';
import { restoreReadinessVault } from '@/lib/readiness-identity';
import { CC, checkTradeWindow, closeDid, makeTerms, parseOffer, signCloseAction, tradePreview, validateCloseMessage,
  type CloseAction, type CloseOffer, type CloseSnapshot, type CloseTerms } from '@/lib/close-call';
import { type FoundryVault, type TechnocoreSignedMessage } from '@/lib/foundry-crypto';
import { decodeStrictUtf8, parseLosslessIntegerJsonBytes } from '@/lib/strict-json';

type Tab = 'desk' | 'market' | 'offer' | 'evidence';
type Entry = { action: CloseAction['kind']; message: TechnocoreSignedMessage; savedAt: string; stage: 'signed' | 'posted' | 'uncertain'; proof?: unknown };
const JOURNAL = 'foundry-close-call-v1:';
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readJournal(did: string): Entry[] {
  const value = JSON.parse(localStorage.getItem(JOURNAL + did) ?? '[]');
  if (!Array.isArray(value) || value.length > 500) throw new Error('Yerel günlük okunamadı. Kanıtları yedekleyip kontrol edin.');
  return value.filter((e) => e?.message?.did === did && ['owner', 'offer', 'accept'].includes(e.action));
}
async function json<T>(response: Response): Promise<T> {
  const value = await response.json() as { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value as T;
}
function compact(did: string) { return `${did.slice(0, 20)}…${did.slice(-6)}`; }
function sideLabel(side: string) { return side === 'buy' ? 'LONG / alış' : 'SHORT / satış'; }
function isLocal() { return typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname); }
function entryId(e: Entry): string { try { return JSON.parse(e.message.text).terms?.id ?? ''; } catch { return ''; } }
function normalizeDid(value: string) {
  const trimmed = value.trim();
  return closeDid(trimmed.startsWith('z') ? `did:key:${trimmed}` : trimmed);
}

export default function CloseCallDesk() {
  const [tab, setTab] = useState<Tab>('desk'); const [vault, setVault] = useState<FoundryVault>();
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [identityError, setIdentityError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [expectedDid, setExpectedDid] = useState(''); const [confirmedDid, setConfirmedDid] = useState('');
  const [snapshot, setSnapshot] = useState<CloseSnapshot>(); const [journal, setJournal] = useState<Entry[]>([]);
  const [priorRegistration, setPriorRegistration] = useState(false);
  const [busy, setBusy] = useState(''); const running = useRef(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [passphrase, setPassphrase] = useState(''); const [confirm, setConfirm] = useState(false);
  const [selected, setSelected] = useState<CloseOffer>(); const [paste, setPaste] = useState('');
  const [draft, setDraft] = useState({ id: '', px: '', qty: '0.10', side: 'buy' as 'buy' | 'sell', sweeps: '2', taker: 'any' });
  useEffect(() => {
    let active = true;
    loadVault().then((stored) => {
      if (!active) return;
      setVault(stored);
      if (stored) {
        setExpectedDid(localStorage.getItem('foundry-readiness-selected-did') ?? stored.did);
        setJournal(readJournal(stored.did));
        setPriorRegistration(localStorage.getItem(JOURNAL + stored.did + ':registered-before') === 'yes');
      }
      setDraft((d) => ({ ...d, id: crypto.randomUUID() }));
    }).catch((e) => { if (active) setIdentityError(e.message); })
      .finally(() => { if (active) setVaultLoaded(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  let normalizedDid = '';
  try { normalizedDid = normalizeDid(expectedDid); } catch { /* Explain invalid input next to the identity field. */ }
  const identityReady = !!vault && vault.did === normalizedDid && normalizedDid === confirmedDid;
  let dataBlock = 'Önce yukarıdaki “Verileri yenile” düğmesine bas.';
  if (snapshot) {
    dataBlock = snapshot.reason || 'Güncel hakem verisi doğrulanamadı. Verileri yenile.';
    if (snapshot.verified && snapshot.price) {
      try {
        checkTradeWindow({ id: 'ui-freshness', maker: CC.referee, px: snapshot.price.ref, qty: '0.1', side: 'buy', taker: 'any', until: snapshot.price.n + 1 }, snapshot.price, clock);
        dataBlock = '';
      } catch (e) { dataBlock = `${(e as Error).message} “Verileri yenile” düğmesine bas.`; }
    }
  }
  const identityBlock = !vaultLoaded ? 'Yerel kasa okunuyor…' : !vault ? 'Soldaki alandan şifreli kasa dosyanı ve parolanı yükle.' : !normalizedDid ? 'Geçerli DID adresini gir.' : vault.did !== normalizedDid ? 'Girilen DID bu kasaya ait değil. Eşleşen kasa dosyasını yükle.' : !identityReady ? 'Soldaki “Bu DID’i kullan” düğmesine bas.' : '';
  const writeBlock = busy || identityBlock || (!isLocal() ? 'İşlem için bu ekranı localhost üzerinden aç.' : dataBlock);
  const writesReady = !writeBlock;
  const ownerBlocked = priorRegistration || snapshot?.registration === 'mint_observed' || journal.some((e) => e.action === 'owner');
  let terms: CloseTerms | undefined, draftError = '';
  try {
    if (vault && snapshot?.price) {
      if (!/^[1-3]$/.test(draft.sweeps)) throw new Error('Teklif en fazla üç tur geçerli olmalı.');
      terms = makeTerms({ id: draft.id, maker: vault.did, px: draft.px, qty: draft.qty, side: draft.side, taker: draft.taker, until: snapshot.price.n + Number(draft.sweeps) });
      checkTradeWindow(terms, snapshot.price);
    }
  } catch (e) { terms = undefined; draftError = (e as Error).message; }
  let acceptBlock = '';
  if (selected) {
    try { checkTradeWindow(selected.terms, snapshot?.price ?? null, clock); }
    catch (e) { acceptBlock = (e as Error).message; }
    if (selected.terms.maker === vault?.did) acceptBlock = 'Bu teklif sana ait. Kendi teklifini kabul edemezsin.';
    else if (vault && !['any', vault.did].includes(selected.terms.taker)) acceptBlock = 'Bu teklif başka bir DID’e ayrılmış.';
  }
  const offerSigned = journal.some((e) => e.action === 'offer' && entryId(e) === draft.id);
  const acceptSigned = !!selected && journal.some((e) => e.action === 'accept' && entryId(e) === selected.terms.id);
  function clearApproval() { setConfirm(false); setPassphrase(''); }
  function changeExpectedDid(value: string) { clearApproval(); setIdentityError(''); setConfirmedDid(''); setExpectedDid(value); }
  function changeTab(next: Tab) { if (busy) return; clearApproval(); setTab(next); setError(''); }
  function updateDraft(patch: Partial<typeof draft>) { clearApproval(); setDraft((d) => ({ ...d, ...patch })); }
  function saveEntry(entry: Entry) {
    const list = readJournal(entry.message.did);
    const index = list.findIndex((e) => e.message.nonce === entry.message.nonce && e.message.room === entry.message.room);
    if (index < 0) list.push(entry); else list[index] = entry;
    if (list.length > 500) throw new Error('Günlük sınırına ulaşıldı. Önce kanıtları yedekleyin.');
    localStorage.setItem(JOURNAL + entry.message.did, JSON.stringify(list)); setJournal(list);
  }
  async function withBusy(name: string, fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(name); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { running.current = false; setBusy(''); clearApproval(); }
  }
  async function refresh() {
    clearApproval();
    await withBusy('Veriler doğrulanıyor…', async () => {
      setSnapshot(undefined);
      const current = await loadVault();
      if (vault && current?.did !== vault.did) throw new Error('Kasa başka sekmede değişmiş. Sayfayı yenile ve DID’i yeniden onayla.');
      const next = await json<CloseSnapshot>(await fetch(`/api/close-call${current ? `?did=${encodeURIComponent(current.did)}` : ''}`, { cache: 'no-store' }));
      setSnapshot(next); if (next.price) setDraft((d) => ({ ...d, px: d.px || next.price!.ref }));
      setClock(Date.now());
      setNotice('Salt-okunur yenileme tamamlandı. Hiçbir kayıt veya işlem gönderilmedi.');
    });
  }
  async function requireIdentity() {
    if (!identityReady || !vault || (await loadVault())?.did !== confirmedDid) throw new Error('Aktif kasa ve onayladığın DID eşleşmiyor.');
    return vault;
  }
  async function confirmIdentity() {
    await withBusy('DID kontrol ediliyor…', async () => {
      setIdentityError('');
      try {
        const did = normalizeDid(expectedDid);
        const current = await loadVault();
        if (!current) { setVault(undefined); throw new Error('Bu tarayıcıya önce şifreli kasa dosyanı yükle.'); }
        if (current.did !== did) throw new Error('Girilen DID ile kasa eşleşmiyor. Doğru kasayı yükle veya yukarıdaki kasa DID’ini kullan.');
        if (vault?.did !== current.did) { setSnapshot(undefined); setSelected(undefined); setPaste(''); }
        const entries = readJournal(current.did);
        setVault(current); setExpectedDid(did); setConfirmedDid(did); setJournal(entries);
        setPriorRegistration(localStorage.getItem(JOURNAL + did + ':registered-before') === 'yes');
        setNotice('İşlem kimliği onaylandı.');
      } catch (e) { setIdentityError((e as Error).message); throw e; }
    });
  }
  async function restoreIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withBusy('Kasa yükleniyor ve parola kontrol ediliyor…', async () => {
      setIdentityError('');
      try {
        if (!restoreFile) throw new Error('Şifreli Foundry kasa dosyanı seç.');
        if (restoreFile.size > 32 * 1024) throw new Error('Kasa dosyası en fazla 32 KiB olabilir.');
        const did = normalizeDid(expectedDid);
        const source = decodeStrictUtf8(await restoreFile.arrayBuffer());
        const restored = await restoreReadinessVault(source, restorePassphrase, did);
        const entries = readJournal(did);
        const registered = localStorage.getItem(JOURNAL + did + ':registered-before') === 'yes';
        await saveVault(restored);
        setVault(restored); setExpectedDid(did); setConfirmedDid(did); setJournal(entries);
        setPriorRegistration(registered); setShowRestore(false); setRestoreFile(undefined);
        setSnapshot(undefined); setSelected(undefined); setPaste('');
        setDraft((d) => ({ ...d, id: crypto.randomUUID() }));
        setNotice('Kasan yüklendi ve DID doğrulandı. Şimdi eski kayıt kanıtını yükleyebilirsin.');
      } catch (e) {
        const message = e instanceof Error && e.name !== 'OperationError' ? e.message : 'Kasa açılamadı. Dosyayı ve kasa parolanı kontrol et.';
        setIdentityError(message); throw new Error(message);
      } finally { setRestorePassphrase(''); }
    });
  }
  async function send(action: CloseAction) {
    if (!writesReady || !confirm || !passphrase) { setError('Yerel bağlantı, güncel veri, DID, parola ve işlem onayı gerekli.'); return; }
    if (action.kind === 'owner' && ownerBlocked) { setError('Kayıt zaten gönderildi; tekrar yok.'); return; }
    await withBusy('Yerelde imzalanıyor ve yayınlanıyor…', async () => {
      if (!navigator.locks) throw new Error('Sekmeler arası imza kilidi desteklenmiyor. Güncel bir tarayıcı kullan.');
      await navigator.locks.request(`foundry-close-call:${confirmedDid}`, async () => {
        const current = await requireIdentity(); const existing = readJournal(current.did);
        if (action.kind === 'owner' && (existing.some((e) => e.action === 'owner') || localStorage.getItem(JOURNAL + current.did + ':registered-before') === 'yes')) throw new Error('Önceki kayıt zaten günlükte; tekrar yok.');
        const chosen = action.kind === 'offer' ? action.terms : action.kind === 'accept' ? action.offer.terms : null;
        if (chosen) {
          checkTradeWindow(chosen, snapshot?.price ?? null);
          if (existing.some((e) => e.action === action.kind && entryId(e) === chosen.id)) throw new Error('Bu işlem zaten imzalandı. Önce kanıt ve sonucu kontrol et.');
        }
        const room = action.kind === 'offer' ? CC.offersRoom : CC.room;
        const fetched = await json<{ nonce: string | null }>(await fetch(`/api/close-call?kind=nonce&room=${room}&did=${encodeURIComponent(current.did)}`, { cache: 'no-store' }));
        const floors = [fetched.nonce, ...existing.filter((e) => e.message.room === room).map((e) => e.message.nonce)].filter((n): n is string => !!n);
        const minimum = floors.reduce<string | undefined>((max, n) => max === undefined || BigInt(n) > BigInt(max) ? n : max, undefined);
        const message = await signCloseAction(current, passphrase, action, minimum); setPassphrase('');
        const entry: Entry = { action: action.kind, message, savedAt: new Date().toISOString(), stage: 'signed' };
        saveEntry(entry); // Fail closed if evidence cannot be persisted BEFORE the POST.
        download(`close-call-${action.kind}-${message.nonce}.json`, entry);
        await requireIdentity();
        try {
          const result = await json<{ status: string; proof: unknown }>(await fetch('/api/close-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'publish_close_call', message }) }));
          if (result.status !== 'posted' || !result.proof) throw new Error('Gönderim kanıtı dönmedi.');
          const posted: Entry = { ...entry, stage: 'posted', proof: result.proof };
          saveEntry(posted); download(`close-call-proof-${message.nonce}.json`, posted);
          setNotice(action.kind === 'owner' ? 'Kayıt sunucuya ulaştı. POLF tahsis kanıtı bekleniyor.' : action.kind === 'offer' ? 'Teklif yayımlandı. Karşı imza ve hakem sonucu olmadan pozisyon açılmaz.' : 'Çift imzalı işlem gönderildi. Hakem sonucu bekleniyor.');
        } catch (e) {
          saveEntry({ ...entry, stage: 'uncertain' });
          throw new Error(`${(e as Error).message} Sonuç belirsiz/başarısız; otomatik tekrar yok. Kanıtları kontrol et.`);
        }
      });
    });
  }
  async function importOwnerProof(file?: File) {
    if (!file) return;
    await withBusy('Kayıt kanıtı doğrulanıyor…', async () => {
      const current = await requireIdentity();
      if (file.size > 256 * 1024) throw new Error('Kanıt en fazla 256 KiB olabilir.');
      const raw = parseLosslessIntegerJsonBytes(await file.arrayBuffer()) as Record<string, unknown>;
      const record = (raw.posted ?? raw.record) as Record<string, unknown>;
      if (!record || (raw.room !== undefined && raw.room !== CC.room)) throw new Error('close1 kayıt kanıtı bekleniyor.');
      const message: TechnocoreSignedMessage = { room: CC.room, did: String(record.from), text: String(record.text), nonce: String(record.nonce), sig: String(record.sig) };
      if (message.did !== current.did || (await validateCloseMessage(message)).kind !== 'owner') throw new Error('Bu DID’e ait owner kanıtı değil.');
      saveEntry({ action: 'owner', message, savedAt: new Date().toISOString(), stage: 'posted', proof: { source: 'imported-server-response', seq: String(record.seq), ts: String(record.ts) } });
      setNotice('Eski kayıt imzası doğrulandı. Tekrar kayıt kilitlendi; bu mint/bakiye kanıtı değildir.');
    });
  }
  function approval(label: string, actionBlock = '') {
    const reason = writeBlock || actionBlock || (!passphrase ? 'İmzalamak için kasa parolanı gir.' : !confirm ? 'Devam etmek için yukarıdaki işlem onayını işaretle.' : 'İşlem imzalamaya hazır.');
    return <div className="close-approval"><label>Kasa parolası<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={!!busy || !identityReady} autoComplete="off" /></label><label className="close-check"><input type="checkbox" checked={confirm} disabled={!!busy || !identityReady} onChange={(e) => setConfirm(e.target.checked)} />{label}</label><p className="close-button-help" role="status">{reason}</p></div>;
  }
  function preview(t: CloseTerms, accepting: boolean) {
    const p = tradePreview(t, accepting, snapshot?.price?.ref ?? t.px);
    return <div className="close-review"><strong>Senin yönün: {sideLabel(p.side)}</strong><dl>
      <div><dt>Fiyat × miktar</dt><dd>{t.px} × {t.qty}</dd></div><div><dt>İşlem değeri</dt><dd>{p.notional} POLF</dd></div>
      <div><dt>Taban ücret (%1)</dt><dd>{p.baseFee} POLF</dd></div><div><dt>Referansla tahmini ücret</dt><dd>{p.estimatedFee} POLF</dd></div>
      <div><dt>Tamamen yeni pozisyon teminatı</dt><dd>{p.collateral} POLF + ücret</dd></div><div><dt>Son geçerli tur</dt><dd>#{t.until}</dd></div></dl>
      <p>Gerçek ücret tur kapanış fiyatıyla belirlenir, daha yüksek olabilir. Pozisyon kapanıyorsa teminat farklıdır. Kullanılabilir bakiye ve kesin zarar burada hesaplanamaz. SHORT zararları yarışma bakiyesini eksiye düşürebilir.</p></div>;
  }
  function status(entry: Entry) {
    if (entry.action === 'owner') return snapshot?.registration === 'mint_observed' ? 'Tahsis kanıtı gözlendi' : 'Kayıt imzası var · tahsis teyitsiz';
    const matches = snapshot?.outcomes.filter((o) => o.id === entryId(entry)) ?? [];
    const settled = matches.find((o) => o.status === 'settled');
    if (settled) return `Hakemde bu id sonuçlandı · tur ${settled.sweep}`;
    const last = matches.at(-1); if (last) return `Bu id için ret: ${last.reason} · tur ${last.sweep}`;
    return entry.stage === 'posted' ? 'Gönderildi · sonuç gözlenmedi' : entry.stage === 'uncertain' ? 'Gönderim sonucu belirsiz' : 'Yerel imza · gönderim teyitsiz';
  }
  return <>
    <header className="close-call-hero"><div><p className="eyebrow">FOUNDRY / CLOSE CALL · CLOSE-1</p><h1>Karar sende.<br /><em>İmza yerelde.</em></h1><p>NVDA yarışması için kendi işlem masan. Teklifleri incele, maliyeti gör, yalnızca onayladığın işlemi imzala.</p><span className="close-badge">POLF: yarışma bakiyesi · gerçek para yatırma yok</span></div>
      <aside className="close-call-status"><span>HAKEM REFERANSI / XYZ:NVDA</span><strong className="close-price">{snapshot?.price ? `$${snapshot.price.ref}` : '—'}</strong><small>{snapshot?.price ? `Tur #${snapshot.price.n} · sınır $${snapshot.price.limits[0]}–$${snapshot.price.limits[1]}` : 'Güncel veriyi almak için yenile.'}</small><small>{snapshot?.reason ?? 'Henüz doğrulanmadı.'}</small><button className="button-secondary" onClick={() => void refresh()} disabled={!!busy}>↻ Verileri yenile (salt okunur)</button><small>İşlemler: 4 Ekim 12.00 TR’de kapanır.<br />Son fiyat: 4 Ekim 13.00 TR.</small></aside></header>
    {(error || notice || busy) && <div className={`close-call-banner ${error ? 'invalid' : 'valid'}`} role={error ? 'alert' : 'status'}>{busy || error || notice}</div>}
    <nav className="close-call-tabs" aria-label="Close Call bölümleri">{([['desk', '01 / Masam'], ['market', '02 / Piyasa'], ['offer', '03 / Teklif oluştur'], ['evidence', '04 / Kanıtlar']] as const).map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} disabled={!!busy} className={tab === key ? 'active' : ''} onClick={() => changeTab(key)}>{label}</button>)}</nav>
    <section className="close-call-shell"><aside className="close-call-card identity-card">
      <p className="micro-label">ŞİFRELİ FOUNDRY KASASI</p><h2>{vault ? 'Kimliğini seç.' : 'Önce kasanı yükle.'}</h2>
      {!vaultLoaded ? <p>Yerel kasa okunuyor…</p> : <>
        {vault ? <><small>Bu tarayıcıdaki kasa DID’i</small><code className="close-did">{vault.did}</code></> : <p>Bu tarayıcıda kasa bulunamadı. Daha önce indirdiğin şifreli <strong>.vault.json</strong> dosyasını aşağıdan yükle. DID adresi tek başına imza atamaz.</p>}
        <label htmlFor="close-identity-did">İşlem yapacağın DID
          <input id="close-identity-did" form="close-vault-restore" required value={expectedDid} disabled={!!busy} onChange={(e) => changeExpectedDid(e.target.value)} onBlur={() => { if (normalizedDid) setExpectedDid(normalizedDid); }} placeholder="did:key:z6Mk…" autoComplete="off" spellCheck={false} aria-describedby="close-identity-help" />
        </label>
        <small id="close-identity-help">Tam DID adresini yapıştır. Başında did:key: yoksa otomatik tamamlanır.</small>
        {identityError && <p className="close-inline-error" role="alert">{identityError}</p>}
        {(!vault || showRestore) ? <form id="close-vault-restore" className="close-vault-restore" onSubmit={(e) => void restoreIdentity(e)}>
          <label>Şifreli kasa dosyası (.vault.json)<input type="file" accept=".json,application/json" required disabled={!!busy} onChange={(e) => { setRestoreFile(e.target.files?.[0]); setRestorePassphrase(''); setIdentityError(''); }} /></label>
          <label>Kasa yedeğinin parolası<input type="password" value={restorePassphrase} onChange={(e) => setRestorePassphrase(e.target.value)} autoComplete="current-password" required disabled={!!busy} /></label>
          <button type="submit" className="button-primary" disabled={!!busy}>{busy && restoreFile ? 'Kasa kontrol ediliyor…' : 'Kasayı yükle ve bu DID’i kullan'}</button>
          <p className="close-button-help">Dosya ve parola bu tarayıcıda kontrol edilir. Kayıt kanıtı dosyası yerine şifreli kasa yedeğini seç.</p>
          {vault && <button type="button" className="button-secondary" disabled={!!busy} onClick={() => { setShowRestore(false); setRestoreFile(undefined); setRestorePassphrase(''); setIdentityError(''); }}>Kasa yüklemeyi kapat</button>}
        </form> : <>
          <button className="button-primary" disabled={!!busy} onClick={() => void confirmIdentity()}>{identityReady ? '✓ Bu DID seçildi' : 'Bu DID’i kullan'}</button>
          <small className={identityReady ? 'close-good' : 'close-button-help'}>{identityReady ? 'Kimlik hazır. Eski kayıt kanıtını yükleyebilir ve verileri yenileyebilirsin.' : identityBlock}</small>
          <button className="button-secondary" disabled={!!busy} onClick={() => { clearApproval(); setShowRestore(true); }}>Başka şifreli kasa yükle</button>
        </>}
      </>}
      <Link href="/readiness">Kasa yedeği ve kimlik yardımı →</Link>
      <p className="close-call-warning">Her teklif ve kabul ayrı onay ister. Açık teklifler protokolde iptal edilemez.</p>
    </aside>
      <article className="close-call-card">
        {tab === 'desk' && <><p className="micro-label">KAYIT / BAKİYE / İŞLEMLER</p><h2>Önce durumunu bil.</h2><div className="close-call-metrics"><div><span>İlk tahsis</span><strong>{snapshot?.registration === 'mint_observed' ? '10.000 POLF' : 'Teyit bekleniyor'}</strong><small>{snapshot?.registration === 'mint_observed' ? 'İmzalı mint listesinde DID bulundu.' : ownerBlocked ? 'Önceki kayıt var. Yokluk ret değildir.' : 'Henüz yerel kayıt kanıtı yok.'}</small></div><div><span>Kullanılabilir bakiye</span><strong>Doğrulanamadı</strong><small>Kısaltılmış kayıtlardan bakiye uydurulmaz.</small></div></div>
          <p>Terminalden zaten kaydoldun mu? Tekrar gönderme. <strong>close-1-owner.server-response.json</strong> dosyanı yükle veya önceki kaydını işaretle.</p><label>Eski kayıt kanıtı (özel anahtar değil)<input type="file" accept=".json,application/json" disabled={!identityReady || !!busy} onChange={(e) => { void importOwnerProof(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="button-secondary" disabled={!identityReady || !!busy || ownerBlocked} onClick={() => { try { localStorage.setItem(JOURNAL + vault!.did + ':registered-before', 'yes'); setPriorRegistration(true); clearApproval(); } catch { setError('Tercih kaydedilemedi.'); } }}>{ownerBlocked ? '✓ Önceki kayıt işaretli' : 'Zaten kayıt yaptım — tekrar gönderme'}</button><small>{identityBlock || 'Bu işaret yalnızca tekrar kaydı engeller; tahsisi doğrulamaz.'}</small>
          {!ownerBlocked && <div className="close-block"><h3>İlk kez kayıt ol</h3>{approval('Yalnızca bu DID için kamuya açık kayıt göndermeyi onaylıyorum. Alım–satım yapılmaz.')}<button className="button-primary" disabled={!writesReady || !confirm || !passphrase} onClick={() => void send({ kind: 'owner' })}>Kayıt gönder · 10.000 POLF talep et</button></div>}
          <div className="close-block"><h3>Yerel işlem günlüğüm</h3>{!journal.length && <p>Bu masadan henüz imza üretilmedi. Başka araçlardaki işlemler otomatik bilinmez.</p>}<div className="close-call-list">{journal.slice().reverse().slice(0, 20).map((e) => <div key={e.message.room + e.message.nonce}><span>{e.action === 'owner' ? 'Kayıt' : e.action === 'offer' ? 'Teklif' : 'Kabul'}<small>{status(e)}</small></span><button className="button-secondary" onClick={() => download(`close-call-${e.message.nonce}.json`, e)}>Kanıt indir</button></div>)}</div><small>Hakem id eşleşmesi, tam şartların bağımsız arşiv doğrulaması değildir.</small></div></>}
        {tab === 'market' && <><p className="micro-label">İMZALI TOPLULUK TEKLİFLERİ</p><h2>Karşı tarafı seç.</h2><p>LONG teklifini kabul edersen SHORT olursun; SHORT teklifini kabul edersen LONG olursun. Görünmesi, teklifin hâlâ boşta veya hesapların fonlu olduğunu garanti etmez.</p>
          {!snapshot && <p>Önce “Verileri yenile” düğmesine bas.</p>}{snapshot && !snapshot.offers.length && <p>Bu okuma penceresinde güncel geçerli teklif bulunamadı.</p>}
          <div className="close-offers">{snapshot?.offers.map((o) => <div className="close-offer" key={o.terms.maker + o.terms.id}><span className="micro-label">SENİN YÖNÜN</span><h3>{sideLabel(o.terms.side === 'buy' ? 'sell' : 'buy')}</h3><strong>${o.terms.px} <small>× {o.terms.qty} NVDA</small></strong><code title={o.terms.maker}>{compact(o.terms.maker)}</code><small>Geçerlilik: tur #{o.terms.until}</small><button className="button-secondary" disabled={!!busy} onClick={() => { clearApproval(); setSelected(o); setPaste(JSON.stringify(o, null, 2)); setTab('evidence'); }}>İncele — henüz imzalama</button></div>)}</div>
          <div className="close-block"><h3>Hakemin yayımladığı ilk sıralar</h3><p>Canlı skor; nihai sonuç veya hesap bakiyesi değil.</p><div className="close-call-list">{snapshot?.leaderboard.slice(0, 10).map((e, i) => Array.isArray(e) ? <div key={i}><code>{i + 1}. {compact(String(e[0]))}</code><span>{String(e[1])} POLF skor</span></div> : null)}</div></div></>}
        {tab === 'offer' && <><p className="micro-label">HAZIRLA → İNCELE → İMZALA</p><h2>Kendi şartlarını koy.</h2><p>Teklif tek başına pozisyon açmaz. İlk geçerli karşı imza ve hakem sonucu gerekir. En fazla üç turluk kısa teklif hazırlıyoruz.</p>
          <fieldset disabled={!!busy || offerSigned} className="close-call-form"><label>Senin yönün<select value={draft.side} onChange={(e) => updateDraft({ side: e.target.value as 'buy' | 'sell' })}><option value="buy">LONG — alış</option><option value="sell">SHORT — satış</option></select></label><label>Fiyat (POLF / NVDA)<input value={draft.px} inputMode="decimal" onChange={(e) => updateDraft({ px: e.target.value })} /></label><label>Miktar (en az 0.10 NVDA)<input value={draft.qty} inputMode="decimal" onChange={(e) => updateDraft({ qty: e.target.value })} /></label><label>Kaç tur geçerli?<select value={draft.sweeps} onChange={(e) => updateDraft({ sweeps: e.target.value })}><option value="1">1 tur · yaklaşık 5 dk</option><option value="2">2 tur · yaklaşık 10 dk</option><option value="3">3 tur · yaklaşık 15 dk</option></select></label><label>Karşı taraf: any veya DID<input value={draft.taker} onChange={(e) => updateDraft({ taker: e.target.value })} spellCheck={false} /></label></fieldset>
          {draftError && <p className="close-call-warning">{draftError}</p>}{!snapshot && <p>Önce verileri yenile.</p>}{terms && preview(terms, false)}
          {offerSigned ? <><p>Bu teklif zaten imzalandı. Tekrar yayımlamıyoruz.</p><button className="button-secondary" disabled={!!busy} onClick={() => { clearApproval(); setDraft((d) => ({ ...d, id: crypto.randomUUID() })); }}>Ayrı, yeni teklif taslağı oluştur</button></> : <>{approval('Yön, fiyat, miktar ve süreyi onaylıyorum. Ücret değişebilir, bakiye teyitsizdir. İmzalı teklif geri alınamaz.', !terms ? draftError || 'Geçerli teklif şartlarını tamamla.' : '')}<button className="button-primary" disabled={!writesReady || !terms || !confirm || !passphrase} onClick={() => terms && void send({ kind: 'offer', terms })}>Yerelde imzala ve teklifi yayımla</button></>}</>}
        {tab === 'evidence' && <><p className="micro-label">TEKLİF DOĞRULAMA / KANIT ARŞİVİ</p><h2>İmzayı gör, sonra karar ver.</h2><label>Paylaşılan teklif JSON’u<textarea value={paste} disabled={!!busy} onChange={(e) => { setPaste(e.target.value); setSelected(undefined); clearApproval(); }} rows={5} maxLength={8192} /></label><button className="button-secondary" disabled={!!busy || !paste} onClick={() => void withBusy('Teklif imzası doğrulanıyor…', async () => { setSelected(undefined); const o = await parseOffer(paste); checkTradeWindow(o.terms, snapshot?.price ?? null); setSelected(o); setNotice('Teklif imzası geçerli. Kabul gönderilmedi.'); })}>İmzayı ve şartları kontrol et</button>
          {selected && <div className="close-block"><p>Teklif sahibi: <code className="close-did">{selected.terms.maker}</code></p>{preview(selected.terms, true)}{acceptSigned ? <p>Kabul imzası zaten günlükte. Tekrar gönderilmiyor.</p> : <>{approval('Karşı yöndeki pozisyonu, miktarı ve ücret riskini onaylıyorum. İşlem herkese açık yayımlanacak; güncel bakiye teyitli değil.', acceptBlock)}<button className="button-primary" disabled={!writesReady || !!acceptBlock || !confirm || !passphrase} onClick={() => void send({ kind: 'accept', offer: selected })}>Yerelde imzala ve kabulü gönder</button></>}</div>}
          <div className="close-block"><h3>Kanıtları yanında tut.</h3><p>İmzalı mesaj yayın öncesinde saklanır. Sunucu yanıtı ayrıca kaydedilir. Parola veya özel anahtar bu dosyalara girmez.</p><div className="readiness-actions"><button className="button-secondary" disabled={!vault || !journal.length} onClick={() => download(`close-call-journal-${vault!.did.slice(-8)}.json`, journal)}>Kendi imza günlüğümü indir</button><button className="button-secondary" disabled={!snapshot} onClick={() => download('close-call-referee-observations.json', snapshot)}>Hakem gözlemlerini indir</button></div></div></>}
        {snapshot && <details className="close-block"><summary>Veri sınırları ve son kontrol</summary><p>{new Date(snapshot.checkedAt).toLocaleString('tr-TR')}</p><ul>{snapshot.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
      </article>
    </section>
  </>;
}
