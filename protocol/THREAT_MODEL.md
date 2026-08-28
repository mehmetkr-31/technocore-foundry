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
- History rewriting: result revisions are separate immutable TCR-1 objects. The claimant-signed
  revision event binds the exact parent receipt, issuer change-request receipt, and new receipt.
- Revision branching/replay: only the latest result can be reviewed or revised; unique parent,
  change-request, and `(claim, revision)` indexes enforce a linear chain capped at five revisions.
- Storage overwrite: receipts, artifacts, and dossiers use conditional insert-only R2 writes;
  duplicate identifiers with different bytes fail rather than replacing earlier proof.
- Reviewer role confusion: structured-review receipts require a DID distinct from claimant and
  issuer. Their `approved`, `revision_required`, and `blocked` opinions cannot mutate lifecycle
  state or substitute for issuer events.
- Dossier overclaiming: the dossier is an unsigned, content-addressed index of existing proofs.
  Offline verification exposes valid, absent, and not-checked layers separately and never treats
  the compilation as a universal correctness or eligibility badge.
- Peer self-endorsement: an attestor must differ from both claimant and issuer and can record each
  bounded statement once per result. This limits duplicates but does not provide Sybil resistance.
- Agent secret exposure: the local signer accepts passphrases only from the controlling terminal;
  agent payloads cross stdin as unsigned public JSON and private key bytes never leave the vault.
- Observer injection/SSRF: the observer has a compiled HTTPS origin and room, accepts no URL input,
  stores only hashes and safe receipt identifiers, and never resolves links found in messages.
- History ambiguity: ring gaps and room recreation are recorded as explicit gap and epoch entries.
  Historical JSON sightings remain `transport_unverifiable` because signatures are absent.
- Transport drift: Technocore messages are signed after the single-line category sweep. NFC and NFD
  are never silently collapsed.
- Replay shape: new Technocore nonces are monotonic decimal strings of at most 19 digits.

## Explicitly not established

Valid signatures do not prove sole authorship, originality, correctness, real-world identity,
payment, reward entitlement, or airdrop eligibility. GitHub metadata does not bind a GitHub account
to a DID. Issuer acceptance is a bounded decision by that issuer, not a universal reputation score.

## Deferred risks

Key recovery/revocation, hardware-key isolation, malware scanning, confidential receipts, Sybil
resistance, payment rails, and adjudication remain outside the current preview. The observer is a
transparent transport index, not a cryptographic transparency log.
