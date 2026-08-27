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
- `type`: `mission`, `claim`, `acceptance`, `change_request`, or `revision`
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

Every event type rejects additional properties in the verifier.

## Restricted JSON profile

- values are null, booleans, safe integers, strings, arrays, and plain objects;
- floats, unsafe integers, duplicate keys, invalid UTF-8, lone Unicode surrogates, cycles, and
  non-JSON constants are rejected;
- object keys are ordered lexicographically by Unicode code point;
- output is compact UTF-8 JSON with unescaped Unicode and no insignificant whitespace.

The safe-integer restriction is a deliberate cross-language subset that prevents browser numeric
precision loss.
