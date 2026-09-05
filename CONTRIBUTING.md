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
npm run test:tclk
npm run test:technocore
npm run test:participation
npm run upstream:verify
npm run tclk:upstream:verify
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

Technocore operational compatibility changes must update the reviewed upstream lock and adapter
together and add affected clean-text, nonce, signature, acknowledgement, export, ownership, and
profile tests. A watcher-generated `docs/UPSTREAM_REVIEW.md` or candidate JSON is untrusted review
data, not permission to copy code, execute upstream dependencies, move the active pin, or merge.
X posts, Spaces/AMA notes, community guides, and model summaries may identify questions but are not
protocol sources.

Never commit a vault, private key, passphrase, token, `.dev.vars`, `.wrangler` state, unpublished
receipt, or personal data. Tests must not create a real Technocore DID, send a Technocore message,
or perform any other external write. Declare the origin and license of copied or generated code,
text, fixtures, and assets.

Security vulnerabilities belong in a [private report](SECURITY.md), not a public issue.

## Dependency maintenance

Dependabot checks npm and GitHub Actions weekly on Monday (Europe/Istanbul). Minor and
patch version updates are grouped, with at most one open version-update pull request per
ecosystem (two total). Major version updates require a deliberate maintainer review.
Security alerts should still be reviewed independently; these version-update limits are
not a promise that security-update pull requests will be quiet.

For a dependency pull request, review the lockfile and run the affected checks. Stage the
reviewed changes before running `npm run release:artifacts`, then commit the generated
release files with the update. The release drift gate also covers workflow and documentation
changes; a red drift check alone does not demonstrate a runtime incompatibility. Do not
disable the gate or merge a dependency change with failing functional checks.

## Proof Commons admission

Proof Commons is deliberately narrower than a general code pull request. An admission pull request
must add exactly one dossier and update only its deterministic display index:

```text
commons/dossiers/fds_<first-24-hex-of-canonical-sha256>.json
public/commons/index.json
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
npm run commons:build
npm run commons:check
npm run test:commons
```

CI uses `pull_request_target` with `contents: read` plus narrowly scoped `statuses: write` permission
to report one fixed status on the candidate head and GitHub test-merge commits. It receives no repository or organization secret.
The workflow, verifier, and admission scripts execute from the trusted base commit; candidate bytes
are checked out separately, treated only as data, and never executed. The verifier never follows URLs
embedded in a dossier. The regenerated index must exactly match trusted deterministic output. A
merged dossier is an immutable public evidence bundle. Corrections are new content-addressed dossiers;
they do not overwrite old bytes. Maintainers may later quarantine an index entry for privacy, abuse,
legal, or integrity reasons while preserving Git history.

## Contribution license

Unless you explicitly state otherwise, an intentional contribution submitted for inclusion is
provided under Apache License 2.0 section 5. No CLA or DCO sign-off is currently required.
