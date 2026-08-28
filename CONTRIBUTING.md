# Contributing to Technocore Foundry

Thank you for helping build a local-first, independently verifiable contribution layer. This is an
unofficial community project. A merged contribution is not proof of identity, authorship, payment,
reward, `$FLOP` allocation, or airdrop eligibility.

## Development contributions

Use Node.js 22.13 or newer. Keep changes focused and run the relevant gates before opening a pull
request:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm run test:protocol
npm run test:signer
npm run test:observer
npm run test:security:unit
npm run test:commons
npm run release:artifacts
```

The HTTP regression and full lifecycle smoke tests require a local server. The lifecycle smoke test
also performs a public GitHub read; neither test is allowed to publish to Technocore.

```bash
npm run dev
# in a second terminal
npm run test:security:http
npm run test:smoke
```

Protocol changes must include the specification update, deterministic fixture, TypeScript and
Python verifier coverage, and a compatibility note. Database migrations are append-only. Generated
protocol fixtures and release artifacts must be regenerated and reviewed with their source change.

Never commit a vault, private key, passphrase, token, `.dev.vars`, `.wrangler` state, unpublished
receipt, or personal data. Tests must not create a real Technocore DID, send a Technocore message,
or perform any other external write. Declare the origin and license of copied or generated code,
text, fixtures, and assets.

Security vulnerabilities belong in a [private report](SECURITY.md), not a public issue.

## Proof Commons admission

Proof Commons is deliberately narrower than a general code pull request. An admission pull request
must add exactly one file and change nothing else:

```text
commons/dossiers/fds_<first-24-hex-of-canonical-sha256>.json
```

The dossier must:

- be exact canonical UTF-8 JSON with no BOM, trailing newline, duplicate key, float, or unsafe integer;
- match its content-addressed filename and pass the offline signature and hash-chain verifier;
- be at most 512 KiB, contain at most 64 receipts and 32 distinct DIDs, and stay within the bounded
  execution, review, peer-evidence, JSON-depth, and node-count profiles;
- contain a signed mission receipt and a signed latest issuer acceptance;
- embed public receipts only—never artifact bytes, secrets, personal data, credential-bearing or
  internal-network URLs, or Git LFS pointers. An exact loopback artifact path is allowed only as a
  declared nonportable reference; Commons never renders or fetches it;
- use a regular non-executable Git blob, not a symlink;
- be intentionally approved by the submitter for permanent public inclusion.

Verify it without network access:

```bash
node packages/signer-cli/bin/foundry-signer.mjs verify-dossier \
  --input commons/dossiers/fds_0123456789abcdef01234567.json
npm run commons:verify
npm run test:commons
```

CI uses the untrusted-fork-safe `pull_request` event, read-only permissions, no secrets, and no URL
fetches. The verifier and admission scripts execute from a separate checkout pinned to the trusted
base commit; the candidate checkout is treated only as untrusted data. A merged dossier is an immutable public evidence bundle. Corrections are new
content-addressed dossiers; they do not overwrite old bytes. Maintainers may later quarantine an
index entry for privacy, abuse, legal, or integrity reasons while preserving Git history.

## Contribution license

Unless you explicitly state otherwise, an intentional contribution submitted for inclusion is
provided under Apache License 2.0 section 5. No CLA or DCO sign-off is currently required.
