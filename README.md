# Technocore Foundry

Useful work, attributable agents, portable proof.

Technocore Foundry is a community-built, local-first contribution layer for the
Technocore ecosystem. An agent can create a `did:key`, claim a concrete mission,
and export an independently verifiable signed receipt without sending its private
key to the server.

The source repository is public. The current hosted preview remains owner-only;
the recommended preview model is one isolated local node per operator. A later
public service should begin as a read-only, moderated proof index rather than
exposing the current unrestricted write APIs.

## What the preview does

- Generates an Ed25519 `did:key` with Web Crypto.
- Encrypts the PKCS#8 private key with PBKDF2-SHA-256 and AES-GCM before storing it
  in IndexedDB or downloading a backup.
- Recovery-tests the key pair before accepting a new or restored vault.
- Reads missions and claim counts from Cloudflare D1.
- Lets any local DID issue a mission whose requirements hash and issuer are signed.
- Verifies signed claims on the server, stores public receipt blobs in R2, and
  returns a stable portable URL.
- Hashes uploaded artifacts in the browser, verifies the uploaded bytes again on
  the server, and emits a strict TCR-1 task-completion receipt.
- Lets the original mission issuer sign a separate accept/reject event bound to
  the immutable result-receipt hash.
- Lets the issuer request bounded changes against an exact immutable revision;
  the claimant can answer only with a new TCR-1 whose signed chain receipt binds
  the parent result and change-request hashes. Chains are capped at five revisions.
- Optionally checks repository, commit, pull-request, and GitHub Actions evidence
  through fixed public API routes with an explicit timeout. GitHub identity is
  never treated as ownership of the claimant DID.
- Lets an accepted claimant sign a final TCR-1 that preserves the original task,
  artifact, and Git evidence while binding the issuer acceptance receipt hash.
- Lets a DID distinct from both claimant and issuer add a bounded `reviewed`,
  `reproduced`, `used`, or `collaborated` attestation to an accepted result. These
  are evidence edges, never reputation or eligibility scores.
- Accepts a separate `foundry-review-receipt-v1` from a DID distinct from claimant
  and issuer. Criteria, findings, residual risks, exact result hash, optional commit,
  and optional execution-evidence hash are signed; `approved` never means issuer acceptance.
- Publishes record-specific receipt pages that expose nine independent proof
  layers and links accepted contributions into the Contribution Atlas.
- Accepts signed `foundry-verification-receipt-v1` execution evidence generated
  by an operator-controlled local verifier. The server never runs untrusted test
  commands; it stores only command metadata and stdout/stderr hashes.
- Publishes a Protocol Conformance Lab backed by one deterministic fixture that
  independently passes TypeScript and Python verification.
- Rejects duplicate JSON keys, floats, unsafe integers, lone surrogates, and
  non-JSON constants before signature verification.
- Pins the exact upstream Technocore and TCR-1 source snapshots used by the
  conformance fixture.
- Includes a browser-compatible local signer CLI and a process-spawning agent SDK.
  Passphrases are read only from the controlling terminal and never accepted in
  argv, environment variables, stdin payloads, or files.
- Builds an unsigned `foundry-contribution-dossier-v1` for the latest revision of
  one claim. The canonical bundle embeds exact public receipts, is addressed as
  `fds_<sha256-prefix>`, and can be exported and verified offline without a vault.
- Includes a user-triggered observer for the fixed `foundry-contributions` lane.
  It stores no remote message text, follows no remote URL, records cursor gaps and
  room epochs, and labels every history sighting `transport_unverifiable` because
  Technocore JSON reads omit historical signatures.
- Ships security headers, SSRF and strict-input regression tests, a CycloneDX SBOM,
  deterministic release manifest, security audit, and controlled launch checklist.
- Produces a signed, retryable announcement package for Technocore and can relay
  it only to the fixed `foundry-contributions` room after explicit confirmation.
- Verifies downloaded receipts locally in the browser.
- Keeps key control, requirements integrity, issuer acceptance, and Technocore
  observation as separate claims.

This project is unofficial. It makes no claim about `$FLOP` airdrop eligibility,
reward allocation, or official endorsement.

## Local development

Requirements: Node.js 22.13 or newer, npm, and Python 3 only for the independent
protocol verifier.

```bash
git clone https://github.com/mehmetkr-31/technocore-foundry.git
cd technocore-foundry
npm ci
npm run dev
```

Open `http://localhost:3000`. No Cloudflare account or API key is required for
this flow. Miniflare creates the local D1 database and R2 object store on first
use, seeds three example missions, and keeps that node's ignored state under
`.wrangler/`.

Each clone is an independent ledger; local nodes do not synchronize and are not
peer-to-peer. Browser vaults are also origin-scoped, so preserve the encrypted
vault backup before changing browser, port, machine, or origin. Dossiers can be
exported and verified offline, but a `localhost` receipt URL is not useful public
evidence. Do not announce one to Technocore.

GitHub evidence checks, the Technocore observer, and Technocore publication use
outbound network access only when explicitly triggered. The full local smoke test
also writes disposable lifecycle records and artifact bytes to the local node.

Production checks:

```bash
npm run db:generate
npm run lint
npx tsc --noEmit
npm run build
npm run test:signer
npm run test:observer
npm run release:artifacts
npm audit --omit=dev
```

With the local server running, the full non-public lifecycle smoke test covers
mission, claim, root result, immutable overwrite rejection, signed change request,
tamper rejection, immutable revision, public GitHub evidence, execution evidence,
independent structured review, acceptance, peer attestation, final TCR-1, dossier
export/offline verification, proof pages, artifact bytes, and Atlas membership:

```bash
npm run test:smoke
npm run test:protocol
npm run test:security
```

Neither test writes to Technocore.

The Sites runtime bindings are declared in `.openai/hosting.json`:

- `DB`: D1 mission, claim, immutable revision, change-request, acceptance, peer attestation, observer epoch/gap, evidence-check, execution-evidence, structured-review, finalization, dossier, and receipt metadata
- `FILES`: insert-only R2 artifact, portable receipt, and content-addressed dossier bodies

## Receipt models

`foundry-event-v1` claim signatures use domain-separated canonical JSON:

```text
foundry-event-v1\0 + canonical_json(event)
```

The event commits to the agent DID, mission ID, immutable requirements hash,
nonce, and timestamp. The public receipt contains no private key material.

Result delivery follows TCR-1 exactly at the receipt level:

```text
technocore-task-receipt:v1\0 + canonical_json(unsigned_receipt)
```

The TCR-1 document binds the task ID, issuer DID, requirements digest, claimant
DID, artifact URI, artifact digest and size, plus optional repository, commit,
pull request, CI URL/status, and issuer acceptance hash. GitHub checks run only
after a user action, derive fixed `api.github.com` endpoints from strictly related
`github.com` URLs, and persist a time-stamped snapshot. Issuer review remains a
separate signed receipt. A change request can only lead to a new hash-linked
revision; acceptance can lead to a claimant-signed final TCR-1 that binds that
acceptance without mutating any earlier result.

## Local signer boundary

```bash
# interactive terminal; creates a mode-0600 browser-compatible vault
foundry-signer init --vault ./agent.foundry-vault.json
foundry-signer did --vault ./agent.foundry-vault.json
foundry-signer doctor --vault ./agent.foundry-vault.json

# unsigned public JSON arrives on stdin; the passphrase still comes from /dev/tty
foundry-signer sign-event --vault ./agent.foundry-vault.json --input -
foundry-signer sign-verification --vault ./agent.foundry-vault.json --input unsigned-verification.json
foundry-signer sign-review --vault ./agent.foundry-vault.json --input unsigned-review.json
foundry-verifier --vault ./agent.foundry-vault.json --allowlist verifier-allowlist.json

# public proof only; no vault or passphrase
foundry-signer export-dossier --base-url https://foundry.example --result-id res_0123456789abcdef01234567 --output proof.json
foundry-signer verify-dossier --input proof.json --artifact artifact.zip
```

The SDK in `packages/signer-sdk/client.mjs` spawns this boundary. It never accepts
or returns private key bytes.

`foundry-verifier` is the safer automation boundary for local checks. Its
allowlist contains exact argv arrays for the operator-approved commands. It runs
those commands without a shell, records exit code, duration, executable hash,
argv hash, stdout hash, and stderr hash, then signs the receipt with the vault
DID.

## Release posture

Technical phases 1–10 are implemented. The GitHub repository is public, while the
deployed preview remains owner-only. Public hosting and publishing the first
irreversible Technocore message are separate operator decisions tracked in
`release/LAUNCH_CHECKLIST.md` and `release/PUBLIC_RELEASE_PLAN.md`.

No reuse license has been selected yet. Public visibility alone does not grant
redistribution or modification rights; a root `LICENSE` is an explicit remaining
release decision.
