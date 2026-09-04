# Technocore Foundry protocol package

This directory contains deterministic, offline-verifiable interoperability material for
Foundry events, TCR-1 receipts, execution evidence receipts, structured review receipts, and
Technocore signed messages.

## Pinned sources

- Historical Technocore fixture provenance: `flop-labs/technocore-chat` at
  `9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c`
- Operational Technocore adapter: official `v0.11.4` at
  `317c01f126c6be5a7c3e71ec8719c2cb4ecf09b5`, recorded in
  [`upstream/technocore-chat.lock.json`](upstream/technocore-chat.lock.json)
- `wanshade/tc-receipts` at `37c9a0eddcc56e414fe9c462c14b7f9f424dc596`

The historical fixture commits are embedded in `fixtures/v1.json`; they must remain stable so the
old vectors retain exact provenance. An operational source update instead requires a reviewed lock
and adapter change plus the dedicated Technocore conformance suite. Change detection alone does not
authorize either update.

## Verification

```bash
npm run test:protocol
npm run test:technocore
npm run test:participation
npm run upstream:verify
npm run tclk:upstream:verify
```

These commands regenerate and verify the deterministic fixture in TypeScript and Python, exercise
the operational Technocore contract adapters, and check that runtime pins remain derived from the
reviewed lock. The Python verifier uses `cryptography==49.0.0` from `requirements-dev.txt`.

The fixture covers:

- canonical Ed25519 `did:key` decoding;
- `foundry-event-v1` claim, issuer change-request, claimant revision-chain, and peer-attestation signatures;
- current TCR-1 claimant object, canonical bytes, and signature;
- `foundry-verification-receipt-v1` verifier signatures bound to exact result receipts and local check digests;
- `foundry-review-receipt-v1` reviewer signatures bound to exact result and verification receipts;
- Technocore's `<room>|<nonce>|<text>` transport signature;
- Unicode code-point key ordering, including integer-like and astral keys;
- duplicate keys, floats, unsafe integers, lone surrogates, invalid UTF-8, and non-JSON constants;
- Technocore's single-line sweep without NFC/NFD normalization.

## Compatibility policy

New receipts use the current TCR-1 claimant object: `{"claimant":{"did":"did:key:…"}}`.
Foundry continues to verify its earlier string claimant receipts so existing proof URLs remain
portable. New canonical output never emits the legacy shape.

Result history is append-only. Existing results become revision 1 roots; revisions 2–5 require a
signed issuer change request and a claimant-signed event that commits to the exact parent,
change-request, and new TCR-1 receipt digests.

Foundry receipt fixtures use a safe cross-language JSON profile: integers must fit JavaScript's
safe integer range. This prevents Python and browser runtimes from signing different values after
numeric precision loss. Technocore room JSONL is a different input boundary: its reader preserves
integer tokens losslessly so a canonical 19-digit nonce can be replayed as decimal text for author
signature verification. Server sequence and timestamp remain unsigned metadata.

The Deal Inspector's signed-JSONL path requires the exact source room, selects only
signature-valid `tclk1` records, and checks each outer signer DID against the frame's `from` DID.
It does not convert JSONL order, sequence, timestamp, generation, inclusion, deadlines, or rail
settlement into signed facts.

Passing these vectors establishes byte-level protocol compatibility only. It does not establish
authorship, contribution truth, real-world identity, issuer acceptance, rewards, or eligibility.
A structured review's `approved` decision remains a reviewer opinion and never substitutes for the
mission issuer's separate `foundry-event-v1` acceptance signature.
