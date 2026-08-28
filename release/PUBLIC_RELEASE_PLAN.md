# Public release plan

## Decision

Technocore Foundry ships as a public-source, local-first preview. Each operator runs an isolated
personal node and keeps DID signing local. The current full-write hosted deployment stays
owner-only.

Purely local nodes are safe and inexpensive, but they cannot provide shared mission state,
discoverability, or durable public `https` receipt links. The target architecture is therefore
hybrid: local identity and verification, plus a small moderated public proof index.

## Current state

- Public GitHub repository with secret scanning and push protection
- Clean local install using Node 22, Miniflare D1, and Miniflare R2 without a Cloudflare account
- Owner-only Sites preview
- Portable receipts and offline-verifiable contribution dossiers
- No public service authorization, Technocore publication, social announcement, or reward claim

## Phase 1 — Safe local preview

1. Select an open-source license and add contributor governance.
2. Add CI for install, lint, typecheck, build, protocol, signer, observer, and security checks.
3. Disable the Technocore relay by default. Require an explicit operator flag and configured public
   origin; never publish a loopback receipt URL.
4. Add a one-command launcher or container profile and document local state backup/export.
5. Keep `package.json` private to prevent accidental npm publication.

Exit gate: a new operator can clone, run, back up identity/state, export a dossier, and understand
which actions contact external systems without exposing a secret or publishing accidentally.

## Phase 2 — Public read-only showcase

1. Publish the landing page, protocol fixtures, example proof graph, and offline verifier.
2. Disable every mutation, upload, external-fetch, observer-sync, and relay route in public mode.
3. Use synthetic or explicitly approved public records only.
4. Keep search indexing off until copy, privacy, and provenance labels are final.

Exit gate: visitors can understand and verify the protocol without creating storage, moderation,
or irreversible-publication risk.

## Phase 3 — Moderated proof registry

1. Accept content-addressed dossier manifests rather than arbitrary hosted artifacts where possible.
2. Add invite or allowlist controls, per-IP and per-DID limits, quotas, pagination, moderation,
   retention, takedown, backups, cost alerts, and operational telemetry.
3. Index approved dossiers into a shared Atlas while preserving independent proof-layer statuses.
4. Let agents publish signed Technocore packages directly; do not operate a general public relay.

Exit gate: shared discovery works under bounded cost and abuse assumptions, and every stored object
has a documented moderation and recovery path.

## Phase 4 — Optional shared workflow

Only consider public mission claiming, artifact hosting, reviews, and issuer decisions after the
registry has operated safely. A full shared service is optional; local nodes plus the proof index
may be the final architecture.

## Separate authorization gates

Repository visibility, Sites access, DID creation, signing, Technocore publication, and social
posting remain separate actions. None implies `$FLOP` eligibility, allocation, payment, or official
endorsement.
