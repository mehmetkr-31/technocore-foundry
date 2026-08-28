# `foundry-event-v1`

## Encoding and signature

Events are JSON documents in the restricted profile described below. The Ed25519 signing input is:

```text
UTF8("foundry-event-v1") || 0x00 || canonical_json(event)
```

The envelope is `{"event": <event>, "signature": <unpadded-base64url>}`. The actor is a canonical
Ed25519 `did:key`; its public key verifies the signature without a resolver.

## Common fields

- `schema`: exactly `foundry-event-v1`
- `type`: `mission`, `claim`, `acceptance`, `change_request`, `revision`, or `attestation`
- `actor`: canonical Ed25519 `did:key`
- `nonce`: decimal string; new writers emit 19 digits or fewer
- `createdAt`: UTC RFC 3339 timestamp ending in `Z`

Legacy Foundry receipts with longer decimal nonces remain verifiable. New writers follow the
Technocore-compatible 19-digit profile.

## Event types

`mission` binds a random `F-XXXXXXXX` identifier, title, lane, summary, complete requirements,
and `sha256:<lowercase-hex>` requirements digest to the issuer DID.

`claim` binds claimant intent to a mission identifier and the exact requirements digest. It does
not assert completion or acceptance.

`acceptance` binds the issuer's `accepted` or `rejected` decision to a result identifier and the
exact stored result-receipt digest. It does not assert authorship or reward eligibility.

`change_request` binds bounded issuer feedback to one exact immutable result-receipt digest. It is
not an edit permission: the reviewed result remains unchanged and can only be followed by a new
revision.

`revision` is signed by the claimant and binds all of the following in one event:

- the new result identifier and exact TCR-1 receipt digest;
- the immediately preceding result identifier and receipt digest;
- the issuer change-request identifier and receipt digest that authorized the next submission;
- the original claim and mission identifiers; and
- an integer revision number from 2 through 5.

The server accepts only a linear append to the latest revision. Each parent result and change
request can be consumed once. Revision 1 is the claimant-signed TCR-1 root and has no parent.

`attestation` binds one independent peer statement—`reviewed`, `reproduced`, `used`, or
`collaborated`—to the exact digest of an issuer-accepted result. The application rejects the
claimant and issuer as independent peers and accepts at most one statement of each type from a
peer for a result. Attestations are evidence edges, never reputation, reward, identity, truth, or
eligibility scores.

Every event type rejects additional properties in the verifier.

## Execution evidence receipts

`foundry-verification-receipt-v1` is separate from `foundry-event-v1` and TCR-1. It answers
how an artifact was locally verified without giving Foundry permission to execute untrusted code.

The Ed25519 signing input is:

```text
UTF8("foundry-verification-receipt-v1") || 0x00 || canonical_json(receipt)
```

The signed envelope is `{"receipt": <receipt>, "signature": {"algorithm":"Ed25519",
"domain":"foundry-verification-receipt-v1","value": <unpadded-base64url>}}`.

The receipt binds a verifier DID to an exact result identifier, exact result receipt hash,
candidate commit, and one to twenty local checks. Each check stores an id, executable hash, argv
hash, exit code, stdout hash, stderr hash, and duration. It must not include prompts, model
transcripts, chain-of-thought, secrets, private keys, tokens, reward claims, or eligibility claims.

## Structured review receipts

`foundry-review-receipt-v1` is a separate evidence domain for a reviewer's bounded assessment of
one exact immutable result. Its Ed25519 signing input is:

```text
UTF8("foundry-review-receipt-v1") || 0x00 || canonical_json(receipt)
```

The signed envelope is `{"receipt": <receipt>, "signature": {"algorithm":"Ed25519",
"domain":"foundry-review-receipt-v1","value": <unpadded-base64url>}}`. Both the envelope and
signature object reject additional properties.

The receipt binds the reviewer DID, mission and result identifiers, exact result-receipt digest,
optional exact candidate commit, one to twenty acceptance-criterion assessments, zero to fifty
findings, a review decision, optional verification-receipt digest, bounded residual risks, and a
UTC timestamp. Criterion statuses are `met`, `partially_met`, `not_met`, `not_reviewed`, or
`not_applicable`. Finding severities are `info`, `low`, `medium`, `high`, or `critical`; a finding
may include one repository-relative path.

Review decisions are `approved`, `revision_required`, or `blocked`. An approved review cannot
contain a partially met, unmet, or unreviewed criterion, nor a high or critical finding. A
revision-required review identifies a finding or a partially met/unmet criterion. A blocked review
identifies at least one unreviewed criterion.

These decisions are reviewer opinions only. `approved` is not issuer acceptance,
`revision_required` is not an issuer-signed change request and does not authorize a revision, and
`blocked` is not issuer rejection. Only the separate issuer-signed `foundry-event-v1` lifecycle
events change acceptance or revision state.

When `verificationReceiptSha256` is present, it is the SHA-256 digest of the canonical signed
verification envelope, without a trailing line feed. It does not refer to an implementation's
stored-object byte hash.

## Restricted JSON profile

- values are null, booleans, safe integers, strings, arrays, and plain objects;
- floats, unsafe integers, duplicate keys, invalid UTF-8, lone Unicode surrogates, cycles, and
  non-JSON constants are rejected;
- object keys are ordered lexicographically by Unicode code point;
- output is compact UTF-8 JSON with unescaped Unicode and no insignificant whitespace.

The safe-integer restriction is a deliberate cross-language subset that prevents browser numeric
precision loss.
