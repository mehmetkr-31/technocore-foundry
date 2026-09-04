# Controlled launch checklist

## Completed technical gates

- [x] Local browser vault, encrypted backup, and restore drill
- [x] Local signer CLI and agent SDK with terminal-only secret entry
- [x] Signed mission, claim, result, issuer review, revision, execution evidence, structured review, attestation, and finalization lifecycle
- [x] D1 structured state and insert-only R2 receipt/artifact/dossier storage
- [x] Portable proof pages, content-addressed dossiers, offline verification, Protocol Conformance Lab, and TS/Python vectors
- [x] Accepted-only Contribution Atlas with evidence edges and no reputation score
- [x] Fixed-origin, fixed-room, user-triggered observer with generation-aware epoch/gap ledger and
      valid/invalid/not-re-verifiable/unsigned author-signature states
- [x] Security headers, regression suite, SBOM, deterministic release manifest, and dependency audit
- [x] Git-moderated Proof Commons with offline admission, deterministic index, and read-only local UI
- [x] Browser-local Proof Inspector with Node/WebCrypto verifier-unit parity, proof-gap report, and no upload/fetch path
- [x] Loopback-only Technocore Readiness workbench with exact live-contract write gate, explicit
      confirmations, backup-file drill, ACK proof, JSONL verifier, unsigned-profile CAS, and `d-`
      room lifecycle controls
- [x] TCLK signed-JSONL import with exact room input and outer-signer-to-frame-`from` binding
- [x] Data-only upstream drift watcher with a bounded draft-PR path and mandatory human adoption
- [x] One-command locked setup, local doctor, and separate vault/D1/R2/dossier recovery guidance
- [x] Owner-only deployment

## Public source release

- [x] Scan tracked files and reachable Git history for credentials, vaults, private keys, and local paths
- [x] Verify a clean `npm ci` and local D1/R2 startup without a Cloudflare account
- [x] Make the GitHub repository public
- [x] Enable secret scanning, push protection, and private vulnerability reporting
- [x] Keep the hosted Sites deployment owner-only
- [x] Add Apache-2.0 license and upstream attribution notices
- [x] Add contributor governance, CODEOWNERS, PR policy, and secretless CI definitions
- [ ] Add the `Trusted Proof Commons admission` status to required branch protection only after candidate-head/test-merge same-repository and fork canaries pass
- [x] Default-disable the Technocore relay unless an operator explicitly configures a public origin
- [x] Durably reserve relay envelopes/nonces and block automatic retry after ambiguous outcomes
- [x] Pin the operational adapter to official Technocore `v0.11.4` and verify repository bindings
      offline

## Per-operator Technocore readiness

- [ ] Use the intended operator DID; do not create identities merely to multiply activity
- [ ] Download its encrypted vault, store passphrase and copies separately, then complete the
      actual downloaded-file recovery drill in `/readiness`
- [ ] If publishing an introduction, use original useful intent, confirm the irreversible lobby
      write, and retain the downloaded acknowledgement proof plus a room JSONL export
- [ ] Treat the DID profile as an unsigned routing hint and publish no secret or personal data
- [ ] Claim a `d-` room only for a real use; inspect owner/allow/nonce state, send a meaningful first
      and second message on purpose, and treat local TTL reminders as non-authoritative
- [ ] Wait for official versioned faucet, wallet, inference, and receipt interfaces; do not represent
      current room activity as testnet spend or a reward score

## Hosted service decisions still required

- [ ] Add authentication or an allowlist for costly and irreversible actions
- [ ] Add per-IP/per-DID rate limits, storage quotas, moderation, retention, and takedown handling
- [ ] Move public mode to read-only proof discovery before enabling shared writes
- [ ] Confirm operational contact, backup/recovery, monitoring, and public privacy wording
- [ ] Back up and baseline any legacy hosted D1, rehearse the additive migration, and verify the production health marker before deploying this code
- [ ] Add an authenticated, evidence-bound operator reconciliation path for reserved or ambiguous relay attempts
- [ ] Exercise the enabled relay route against a migrated real D1 binding under concurrent requests
- [ ] Run the Inspector interaction/accessibility matrix in supported browsers
- [ ] Change Sites access from owner-only to public
- [ ] Publish the first irreversible signed message to `foundry-contributions`
- [ ] Post any external social announcement

These unchecked items are intentionally not automated. Completing the technical release does not
authorize hosted public access, a Technocore write, a social post, or an airdrop/eligibility claim.
