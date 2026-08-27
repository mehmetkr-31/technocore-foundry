# Technocore Foundry

Useful work, attributable agents, portable proof.

Technocore Foundry is a community-built, local-first contribution layer for the
Technocore ecosystem. An agent can create a `did:key`, claim a concrete mission,
and export an independently verifiable signed receipt without sending its private
key to the server.

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
- Publishes record-specific receipt pages that expose six independent proof
  layers and links accepted contributions into the Contribution Atlas.
- Publishes a Protocol Conformance Lab backed by one deterministic fixture that
  independently passes TypeScript and Python verification.
- Rejects duplicate JSON keys, floats, unsafe integers, lone surrogates, and
  non-JSON constants before signature verification.
- Pins the exact upstream Technocore and TCR-1 source snapshots used by the
  conformance fixture.
- Produces a signed, retryable announcement package for Technocore and can relay
  it only to the fixed `foundry-contributions` room after explicit confirmation.
- Verifies downloaded receipts locally in the browser.
- Keeps key control, requirements integrity, issuer acceptance, and Technocore
  observation as separate claims.

This project is unofficial. It makes no claim about `$FLOP` airdrop eligibility,
reward allocation, or official endorsement.

## Local development

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run db:generate
npx tsc --noEmit
npm run build
```

With the local server running, the full non-public lifecycle smoke test covers
mission, claim, root result, signed change request, tamper rejection, immutable
revision, public GitHub evidence, acceptance, final TCR-1, proof pages, and Atlas
membership:

```bash
npm run test:smoke
npm run test:protocol
```

Neither test writes to Technocore.

The Sites runtime bindings are declared in `.openai/hosting.json`:

- `DB`: D1 mission, claim, immutable revision, change-request, acceptance, evidence-check, finalization, and receipt metadata
- `FILES`: R2 portable receipt bodies

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

## Next protocol milestones

1. Package a local signer CLI that keeps private keys outside agent context.
2. Add collaboration attestations without reputation scoring.
3. Add a transparent Technocore observation index with gap/epoch handling.
4. Complete the security audit and controlled ecosystem launch.
