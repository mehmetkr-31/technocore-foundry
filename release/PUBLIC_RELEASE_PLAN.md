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
- Apache-2.0 license, contributor governance, secretless CI, and CODEOWNERS
- Git-backed, offline-verified Proof Commons registry with a read-only local UI
- Browser-local Proof Inspector with no upload, storage, resolver, or dossier URL fetch
- Loopback-only Technocore Readiness workbench with a real backup-file drill, explicitly confirmed
  public writes, acknowledgement proof, offline JSONL verification, unsigned-profile warnings,
  owned-room lifecycle controls, and local-only TTL reminders
- TCLK Inspector path that verifies signature-valid JSONL authors against each frame's `from` DID
  while leaving server metadata, inclusion, deadline, and settlement claims unproved
- One-command locked setup, local readiness doctor, and documented cold-state recovery
- Protected `main` branch with strict required CI checks and no administrator bypass
- Technocore relay disabled unless an explicit flag and matching public HTTPS origin are configured
- Personal-node relay uses durable nonce/envelope reservation and blocks ambiguous automatic replay
- Data-only Technocore and TCLK upstream watchers that open draft reviews without executing
  upstream code, changing operational locks, or auto-merging
- No repository action authorizes public service access, a Technocore write, a social announcement,
  or a reward claim

## Phase 1 — Safe local preview

1. Maintain the Apache-2.0 license, contributor governance, and attribution notices.
2. Keep secretless CI for install, lint, typecheck, build, protocol, signer, observer, TCLK,
   Technocore contract, upstream-lock, security, and Proof Commons checks green.
3. Disable the Technocore relay by default. Require an explicit operator flag and configured public
   origin; never publish a loopback receipt URL. Persist a reservation before the upstream request,
   make confirmed results idempotent, and fail closed rather than replay an ambiguous outcome.
4. Keep locked setup (`npm run setup`) separate from the explicit long-running start command
   (`npm run dev`) and document local state backup/export. Do not hide installation or network
   activity inside an implicit launcher.
5. Keep `package.json` private to prevent accidental npm publication.
6. Keep the full-write Readiness workbench loopback-only. Require explicit confirmation and an
   exact live-contract match; never turn its local retention reminders into scheduled writes.
7. Treat upstream release, source/changelog, and live API drift as untrusted review data. Runtime
   adoption requires a separate human-reviewed lock, adapter, and conformance-test change.

Implementation status: the Phase 1 local controls are present using the documented two-command
setup/start flow. A clean-machine release rehearsal remains
part of each tagged preview, but it does not authorize public hosting or publication.

Exit gate: a new operator can clone, run, complete a downloaded-vault recovery drill, back up node
state, export a dossier and Technocore evidence, and understand which actions contact external
systems without exposing a secret or publishing accidentally.

## Phase 2 — Public read-only showcase

1. Publish the landing page, Proof Commons, protocol fixtures, example proof graph, and offline verifier.
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
posting remain separate actions. Future faucet claim, wallet binding, inference spend, mining, and
validation would require additional reviewed interfaces and separate user actions. None implies
`$FLOP` eligibility, allocation, payment, or official endorsement.
