# Technocore Foundry security audit

Audit target: `0.9.0-preview.7`
Launch posture: owner-only preview; public Technocore writes require a separate human action.

## Enforced boundaries

- Private Ed25519 key material stays in the encrypted local vault. Browser and CLI vaults use
  PBKDF2-SHA-256 (310,000 iterations) plus AES-256-GCM with the raw public key as authenticated
  associated data.
- The signer CLI accepts passphrases only from the controlling terminal. It has no passphrase
  argv, environment, stdin, or file option; the agent SDK sends only unsigned public payloads.
- JSON receipts use strict UTF-8, duplicate-key rejection, safe integers, canonical key order,
  exact allowlists, and bounded bodies.
- Result revisions are append-only, limited to five, and bind the parent receipt plus the issuer's
  exact change-request receipt. Stale decisions and altered parent hashes fail closed.
- Peer attestations require a distinct DID from both issuer and claimant, bind an accepted result
  digest, and are displayed as evidence types—not reputation or eligibility scores.
- Execution evidence receipts are produced by an operator-controlled local verifier. Foundry stores
  signed metadata and stdout/stderr hashes only; it does not run arbitrary project tests on the
  server.
- Structured reviews require a DID distinct from claimant and issuer, bind the exact immutable
  result and optional execution-evidence digest, and cannot create acceptance or a change request.
- GitHub evidence accepts only plain `https://github.com/<owner>/<repo>` paths and same-repository
  commit, PR, and Actions-run identifiers. Credentials, ports, queries, fragments, alternate hosts,
  and redirect URLs are rejected before any fetch.
- The observer has one compiled origin and room. It accepts no URL input, stores no remote message
  text, fetches no remote message link, records cursor gaps and room epochs, and labels all JSON
  history as `transport_unverifiable` because the read lane omits signatures.
- R2 receipt, artifact, and dossier objects are created with an insert-only precondition; an
  existing key is accepted only when its exact bytes and SHA-256 match. D1 receipt metadata uses
  insert semantics rather than replacement. Receipt schemas reject keys
  containing secret, private, password, token, airdrop, or eligibility claims.
- Contribution dossiers are unsigned, size-bounded, content-addressed compilations. Export includes
  only one latest claim chain, embeds public receipts rather than secrets or raw artifacts, and the
  offline verifier reports each proof layer independently.
- Global responses set CSP, clickjacking, MIME-sniffing, referrer, permissions, opener, and resource
  isolation headers.

## Regression gates

`npm run test:security` checks security headers, duplicate JSON keys, invalid UTF-8, body limits,
tampered signatures, fixed-origin observer behavior, receipt-ID boundaries, SSRF URL policy,
cross-repository binding, and forbidden receipt fields. `npm run test:smoke` additionally checks
stale acceptance, immutable identifier collisions, altered revision parent hashes, execution
evidence binding, independent structured reviews and attestations, dossier export/offline
verification, proof pages, Atlas, and artifact byte round-trips.

## Residual risks

- `npm audit --omit=dev` reports zero production vulnerabilities. The complete development tree
  reports four moderate advisories inherited by `drizzle-kit` through its legacy esbuild loader;
  that migration generator is run as a local one-shot CLI, never shipped in the Worker or exposed
  as a development server. High-severity toolchain findings were removed by upgrading Vite,
  Vinext, Cloudflare tooling, React RSC packages, and Wrangler.
- Browser malware, a compromised operating system, or a malicious extension can capture a vault
  passphrase after unlock; Foundry does not claim hardware-key isolation.
- D1/R2 and the hosting account remain operator trust boundaries.
- Technocore transport observations cannot reconstruct or verify historical signatures from the
  current JSON read response.
- GitHub object existence does not bind a GitHub account to a claimant DID or establish authorship.
- Public launch can attract abuse and moderation load. The preview remains owner-only until the
  operator explicitly approves public access and an irreversible announcement.
