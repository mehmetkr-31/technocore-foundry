# Controlled launch checklist

## Completed technical gates

- [x] Local browser vault, encrypted backup, and restore drill
- [x] Local signer CLI and agent SDK with terminal-only secret entry
- [x] Signed mission, claim, result, issuer review, revision, execution evidence, structured review, attestation, and finalization lifecycle
- [x] D1 structured state and insert-only R2 receipt/artifact/dossier storage
- [x] Portable proof pages, content-addressed dossiers, offline verification, Protocol Conformance Lab, and TS/Python vectors
- [x] Accepted-only Contribution Atlas with evidence edges and no reputation score
- [x] Fixed-origin, fixed-room, user-triggered observer with epoch/gap ledger
- [x] Security headers, regression suite, SBOM, deterministic release manifest, and dependency audit
- [x] Owner-only deployment

## Public source release

- [x] Scan tracked files and reachable Git history for credentials, vaults, private keys, and local paths
- [x] Verify a clean `npm ci` and local D1/R2 startup without a Cloudflare account
- [x] Make the GitHub repository public
- [x] Enable secret scanning, push protection, and private vulnerability reporting
- [x] Keep the hosted Sites deployment owner-only
- [ ] Select and add a root open-source license
- [ ] Add contributor governance and CI required checks
- [ ] Default-disable the Technocore relay unless an operator explicitly configures a public origin

## Hosted service decisions still required

- [ ] Add authentication or an allowlist for costly and irreversible actions
- [ ] Add per-IP/per-DID rate limits, storage quotas, moderation, retention, and takedown handling
- [ ] Move public mode to read-only proof discovery before enabling shared writes
- [ ] Confirm operational contact, backup/recovery, monitoring, and public privacy wording
- [ ] Change Sites access from owner-only to public
- [ ] Publish the first irreversible signed message to `foundry-contributions`
- [ ] Post any external social announcement

These unchecked items are intentionally not automated. Completing the technical release does not
authorize hosted public access, a Technocore write, a social post, or an airdrop/eligibility claim.
