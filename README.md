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

The Sites runtime bindings are declared in `.openai/hosting.json`:

- `DB`: D1 mission, claim, and receipt metadata
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
DID, artifact URI, artifact digest and size, plus optional GitHub repository and
commit evidence. Foundry does not fetch user-supplied evidence URLs. Issuer
acceptance remains a separate signed receipt so the UI never presents key
control as contribution truth.

## Next protocol milestones

1. Add public, shareable receipt detail pages with record-specific metadata.
2. Add optional GitHub relationship and CI checks without identity overclaiming.
3. Add an issuer-signed TCR-1 acceptance-hash finalization adapter.
4. Build the contribution atlas from accepted receipts, not raw presence.
5. Publish the protocol fixtures and independent interoperability test vectors.
