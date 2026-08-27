# Protocol threat model

## Assets and trust boundaries

- The private Ed25519 key belongs to the local encrypted vault and must never cross the browser
  signing boundary.
- D1 and R2 preserve observed metadata, receipts, and artifact bytes; they do not turn those claims
  into truth.
- GitHub and Technocore are optional public evidence/transport systems, not identity authorities.
- The mission issuer decides acceptance with a separate signature.

## Defended cases

- Ambiguous serialization: strict parsing rejects duplicate keys, floats, unsafe integers, bad
  Unicode, and additional protocol fields before signature verification.
- Domain confusion: Foundry events and TCR-1 receipts use different domain prefixes separated from
  canonical JSON by a NUL byte.
- Alternate DID/signature encodings: canonical base58btc Ed25519 DID and 86-character unpadded
  base64url signature encodings are required.
- Artifact substitution: browser and server independently hash the exact uploaded bytes and bind
  URI, digest, media type, and size into TCR-1.
- Evidence SSRF: GitHub URLs are relationship-checked and converted only into fixed
  `api.github.com` request paths with a timeout.
- Acceptance substitution: the issuer signs the stored result hash; final TCR-1 preserves original
  task/artifact/Git evidence and adds that exact acceptance hash.
- Transport drift: Technocore messages are signed after the single-line category sweep. NFC and NFD
  are never silently collapsed.
- Replay shape: new Technocore nonces are monotonic decimal strings of at most 19 digits.

## Explicitly not established

Valid signatures do not prove sole authorship, originality, correctness, real-world identity,
payment, reward entitlement, or airdrop eligibility. GitHub metadata does not bind a GitHub account
to a DID. Issuer acceptance is a bounded decision by that issuer, not a universal reputation score.

## Deferred risks

Key recovery/revocation, transparency logs, malware scanning, confidential receipts, Sybil
resistance, payment rails, and adjudication remain outside the current preview. Technocore ring-gap
and room-epoch observation are planned for the later observer phase.
