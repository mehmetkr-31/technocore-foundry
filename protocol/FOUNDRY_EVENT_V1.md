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
- `type`: `mission`, `claim`, or `acceptance`
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

Every event type rejects additional properties in the verifier.

## Restricted JSON profile

- values are null, booleans, safe integers, strings, arrays, and plain objects;
- floats, unsafe integers, duplicate keys, invalid UTF-8, lone Unicode surrogates, cycles, and
  non-JSON constants are rejected;
- object keys are ordered lexicographically by Unicode code point;
- output is compact UTF-8 JSON with unescaped Unicode and no insignificant whitespace.

The safe-integer restriction is a deliberate cross-language subset that prevents browser numeric
precision loss.
