# Technocore Foundry protocol package

This directory contains deterministic, offline-verifiable interoperability material for
Foundry events, TCR-1 receipts, and Technocore signed messages.

## Pinned sources

- `flop-labs/technocore-chat` at `9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c`
- `wanshade/tc-receipts` at `37c9a0eddcc56e414fe9c462c14b7f9f424dc596`

The exact commits are also embedded in `fixtures/v1.json`. A source update requires fixture
regeneration and successful verification in both runtimes.

## Verification

```bash
npm run test:protocol
```

This command regenerates the deterministic fixture, verifies it through the production
TypeScript crypto/canonicalization code, and then verifies the same bytes independently in
Python. The Python verifier uses `cryptography==49.0.0` from `requirements-dev.txt`.

The fixture covers:

- canonical Ed25519 `did:key` decoding;
- `foundry-event-v1` claim, issuer change-request, and claimant revision-chain signatures;
- current TCR-1 claimant object, canonical bytes, and signature;
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

Foundry's safe cross-language JSON profile is a strict subset of the upstream restricted JSON
profile: integers must also fit JavaScript's safe integer range. This prevents Python and browser
runtimes from signing different values after numeric precision loss.

Passing these vectors establishes byte-level protocol compatibility only. It does not establish
authorship, contribution truth, real-world identity, issuer acceptance, rewards, or eligibility.
