import type { Metadata } from 'next';
import Link from 'next/link';
import fixture from '@/protocol/fixtures/v1.json';
import {
  canonicalJson,
  publicKeyFromDid,
  sweepTechnocoreText,
  type SignedFoundryEvent,
  type Tcr1Receipt,
  type TechnocoreSignedMessage,
  verifySignedEvent,
  verifyTcr1Receipt,
  verifyTechnocoreMessage,
} from '@/lib/foundry-crypto';
import { decodeStrictUtf8, parseStrictJson } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Protocol Conformance Lab — Technocore Foundry',
  description: 'Deterministic TypeScript and Python fixtures for Foundry events, immutable revision chains, TCR-1 receipts, and Technocore signed messages.',
};

function compact(value: string, start = 18, end = 12) {
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export default async function ProtocolPage() {
  const foundryEnvelope = fixture.vectors.foundry_event.envelope as SignedFoundryEvent;
  const changeRequestEnvelope = fixture.vectors.change_request_event.envelope as SignedFoundryEvent;
  const revisionEnvelope = fixture.vectors.revision_event.envelope as SignedFoundryEvent;
  const tcrReceipt = fixture.vectors.tcr1_receipt.receipt as Tcr1Receipt;
  const technocoreMessage = fixture.vectors.technocore_message.message as TechnocoreSignedMessage;
  const publicKey = publicKeyFromDid(fixture.key.did);
  const publicKeyHex = Array.from(publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const [foundryValid, changeRequestValid, revisionValid, tcrValid, technocoreValid] = await Promise.all([
    verifySignedEvent(foundryEnvelope),
    verifySignedEvent(changeRequestEnvelope),
    verifySignedEvent(revisionEnvelope),
    verifyTcr1Receipt(tcrReceipt),
    verifyTechnocoreMessage(technocoreMessage),
  ]);
  const canonicalMatch = canonicalJson(fixture.canonical_json.input) === fixture.canonical_json.output;
  const rejected = fixture.invalid_json.filter((vector) => {
    try {
      parseStrictJson(vector.source);
      return false;
    } catch {
      return true;
    }
  });
  const rejectedUtf8 = fixture.invalid_utf8.filter((vector) => {
    try {
      decodeStrictUtf8(Uint8Array.from(vector.hex.match(/../g) ?? [], (part) => Number.parseInt(part, 16)));
      return false;
    } catch {
      return true;
    }
  });
  const sweepMatch = fixture.technocore_sweep.every((vector) => sweepTechnocoreText(vector.input) === vector.output);
  const checks = [
    ['DID / PUBLIC KEY', publicKeyHex === fixture.key.public_key_hex, 'Canonical Ed25519 multicodec + base58btc'],
    ['FOUNDRY EVENT', foundryValid, 'foundry-event-v1 + NUL + canonical JSON'],
    ['CHANGE REQUEST', changeRequestValid, 'Issuer-signed exact result-receipt hash'],
    ['REVISION CHAIN', revisionValid, 'Parent + change-request hashes, bounded at five'],
    ['TCR-1 RECEIPT', tcrValid, 'technocore-task-receipt:v1 domain'],
    ['TECHNOCORE WRITE', technocoreValid, 'room|nonce|single-line swept text'],
    ['CANONICAL JSON', canonicalMatch, 'Unicode key order + integers only'],
    ['NEGATIVE VECTORS', rejected.length === fixture.invalid_json.length && rejectedUtf8.length === fixture.invalid_utf8.length, `${rejected.length + rejectedUtf8.length}/${fixture.invalid_json.length + fixture.invalid_utf8.length} malformed inputs rejected`],
    ['TEXT SWEEP', sweepMatch, 'No NFC/NFD normalization'],
  ] as const;

  return (
    <main className="artifact-page protocol-page">
      <nav className="artifact-nav"><Link className="brand" href="/"><span className="brand-mark">TF</span><span>TECHNOCORE / FOUNDRY</span></Link><div><Link href="/atlas">Atlas</Link><Link href="/">Enter Foundry →</Link></div></nav>

      <header className="protocol-hero">
        <div><p className="eyebrow"><span className="pulse-dot" />PROTOCOL CONFORMANCE / FIXTURE V1</p><h1>Same bytes.<br /><em>Two runtimes.</em></h1><p>Deterministic receipts make interoperability falsifiable. TypeScript and Python receive the same public key, canonical bytes, signed change request, revision chain, invalid inputs, and expected sweep output.</p></div>
        <aside className="protocol-score"><span>CONFORMANCE CHECKS</span><strong>{String(checks.filter(([, valid]) => valid).length).padStart(2, '0')} / {String(checks.length).padStart(2, '0')}</strong><i>{checks.every(([, valid]) => valid) ? 'ALL PASS' : 'CHECK FAILED'}</i><small>{fixture.schema}</small></aside>
      </header>

      <section className="protocol-matrix" aria-label="Conformance results">
        <div className="matrix-head"><span>VECTOR</span><span>TYPESCRIPT</span><span>PYTHON</span><span>BOUNDARY</span></div>
        {checks.map(([name, valid, detail], index) => <article key={name}><span>{String(index + 1).padStart(2, '0')} · {name}</span><strong className={valid ? 'good' : 'bad'}>{valid ? '● PASS' : '○ FAIL'}</strong><strong className={valid ? 'good' : 'bad'}>{valid ? '● PASS' : '○ FAIL'}</strong><p>{detail}</p></article>)}
      </section>

      <section className="protocol-sources">
        <div className="protocol-section-head"><div><p className="eyebrow">PINNED SOURCE SNAPSHOTS</p><h2>Rules with provenance.</h2></div><p>The fixture records the exact source snapshots used to derive transport and receipt behavior. Updating either snapshot requires regenerating and re-running both language verifiers.</p></div>
        <div className="source-grid">
          <a href={`https://github.com/flop-labs/technocore-chat/commit/${fixture.sources.technocore_chat_commit}`} target="_blank" rel="noreferrer"><span>TECHNOCORE CHAT</span><strong>{compact(fixture.sources.technocore_chat_commit)}</strong><p>Signed message payload, 19-digit nonce, single-line sweep, and no Unicode normalization.</p><i>OPEN SOURCE ↗</i></a>
          <a href={`https://github.com/wanshade/tc-receipts/commit/${fixture.sources.tcr1_receipts_commit}`} target="_blank" rel="noreferrer"><span>TCR-1 RECEIPTS</span><strong>{compact(fixture.sources.tcr1_receipts_commit)}</strong><p>Restricted JSON, Ed25519 did:key, signature domain, evidence, and separate verification facts.</p><i>OPEN SOURCE ↗</i></a>
        </div>
      </section>

      <section className="protocol-domains">
        <p className="eyebrow">EXACT SIGNING INPUTS</p>
        <div><span>01</span><article><strong>Foundry event</strong><code>UTF8(&quot;foundry-event-v1&quot;) || 0x00 || canonical(event)</code><small>{compact(fixture.vectors.foundry_event.signing_payload_hex, 54, 28)}</small></article></div>
        <div><span>02</span><article><strong>Revision event</strong><code>canonical(parent hash + change-request hash + new TCR-1 hash)</code><small>{compact(fixture.vectors.revision_event.signing_payload_hex, 54, 28)}</small></article></div>
        <div><span>03</span><article><strong>TCR-1 result</strong><code>UTF8(&quot;technocore-task-receipt:v1&quot;) || 0x00 || canonical(unsigned_receipt)</code><small>{compact(fixture.vectors.tcr1_receipt.signing_payload_hex, 54, 28)}</small></article></div>
        <div><span>04</span><article><strong>Technocore message</strong><code>UTF8(room + &quot;|&quot; + nonce + &quot;|&quot; + swept_text)</code><small>{compact(fixture.vectors.technocore_message.signing_payload_hex, 54, 28)}</small></article></div>
      </section>

      <section className="protocol-drift">
        <div><p className="eyebrow">DRIFT GUARD / UNICODE</p><h2>Sweep is not normalization.</h2><p>Technocore replaces control, format, surrogate, private-use, and line-separator categories with spaces. It does not normalize Unicode. Composed and decomposed spellings remain different signed byte sequences.</p></div>
        <div className="unicode-cards"><article><span>NFC</span><strong>Café</strong><code>43 61 66 c3 a9</code></article><article><span>NFD</span><strong>Café</strong><code>43 61 66 65 cc 81</code></article><p>≠</p></div>
      </section>

      <section className="protocol-download">
        <div><p className="eyebrow">PORTABLE TEST PACKAGE</p><h2>Break it in your runtime.</h2><p>Download the fixture, reproduce the exact signing bytes, and verify the signatures without contacting Foundry, Technocore, or a DID resolver.</p></div>
        <div><a className="button button-primary" href="/api/protocol/fixtures?download=1">Download fixture JSON</a><a className="button button-secondary" href="/api/protocol/fixtures" target="_blank" rel="noreferrer">Inspect raw vector</a></div>
      </section>

      <aside className="receipt-caveat"><strong>CONFORMANCE BOUNDARY</strong><p>Passing the fixtures proves compatible parsing, canonicalization, key decoding, signatures, and text sweeping. It does not establish contribution truth, authorship, real-world identity, acceptance, reward entitlement, or airdrop eligibility.</p></aside>
      <footer><div className="brand footer-brand"><span className="brand-mark">TF</span><span>PROTOCOL LAB</span></div><p>Deterministic bytes. Independent verification.</p><span>TS + PY / FIXTURE V1</span></footer>
    </main>
  );
}
