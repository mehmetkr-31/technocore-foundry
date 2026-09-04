# Local operations

Technocore Foundry is local-first. An operator has four independent state/evidence categories;
back them up and restore them separately.

## One-command setup

Use Node 22.13.0 or newer, then run:

```bash
npm run setup
npm run dev
```

`npm run setup` installs the exact lockfile, checks the offline Commons index, and proves that the
local D1 and R2 bindings can be read. The install step contacts the npm registry. It does not create
a DID, read Technocore or GitHub, start the observer, publish a message, or enable the relay.

Run `npm run doctor` at any time for the same local readiness checks. Keep the browser origin exactly
`http://localhost:3000`; changing the hostname or port creates a different IndexedDB vault scope.

## 1. Encrypted identity vault

The browser vault is not stored under `.wrangler/`. In Foundry, open the active DID control and use
**Download backup**. Preserve the downloaded `technocore-foundry-….vault.json` file and its
passphrase separately. Passphrase loss has no reset path.

Before restoring a different vault, download the currently active vault. The restore flow replaces
the vault for that exact browser origin after an unlock and sign/verify recovery test.

CLI vaults can be checked without contacting a network:

```bash
npm run signer -- doctor --vault ./agent.foundry-vault.json
```

Confirm that the printed DID is the DID you expected. Do not pass the passphrase through argv,
environment variables, redirected stdin, or files. The CLI currently requires macOS, Linux, or
WSL2 for its controlling-terminal secret entry.

The Readiness page separates key-pair self-test from backup recovery. After downloading the
encrypted vault, select that actual file in the **Downloaded-backup recovery drill**, enter its
passphrase, and verify that it resolves to the active DID. The drill parses and unlocks the saved
bytes without replacing the active vault. Keep two encrypted copies in separate failure domains
and keep the passphrase separate. The drill timestamp is only local browser state; losing or
clearing that origin's storage removes the marker and does not affect the backup file.

## 2. Local node state: D1 and R2 together

The ignored `.wrangler/state/` directory contains the local D1 database and R2 objects. It does not
contain the browser identity vault.

For a cold backup:

1. Stop `npm run dev` completely.
2. Confirm no Foundry dev process is running.
3. Copy the entire `.wrangler/state/` directory as one unit.
4. Record the repository commit and preserve `package-lock.json` with the backup.

Never copy active SQLite files or their WAL companions, merge two state directories, or restore only
D1 or only R2. Miniflare state is implementation-version-coupled.

The SQL files under `drizzle/` are authoritative for any deployed database. Run
`npm run test:migrations` to apply the complete journal to a blank SQLite database and check its
integrity. Fresh local development nodes may bootstrap the same schema lazily; production mode
instead fails closed if the committed migrations were not applied before traffic.

This preview does not ship D1 deployment credentials or a production migration command. Do not
point the full migration journal at a database created by an older request-time bootstrap: it has
no migration ledger, so the initial `CREATE TABLE` statements will collide. Before any hosted code
update, keep access owner-only, take a recoverable D1/R2 backup, determine whether the database is a
fresh migrated database or a legacy bootstrapped database, baseline the legacy schema or apply only
the reviewed additive migration through the operator's deployment mechanism, and confirm
`/api/health` reports the current schema. That hosted rehearsal remains an explicit launch blocker.

For restore, stop the server, move the current `.wrangler/state/` aside as a recoverable backup,
place the complete saved state at the same path, install the preserved lockfile with `npm ci`, and
run `npm run doctor` before using the node. Doctor proves that the D1 and R2 bindings are readable;
it does not prove that every historical object survived. Before each backup, record at least one
known mission ID plus the SHA-256 values of a receipt, artifact, and dossier. After restore, open or
export those exact records and compare their hashes before accepting new work.

## 3. Portable contribution dossiers

A dossier is public-proof material, not a node backup. Export it after a lifecycle is complete and
verify the exact canonical file offline:

```bash
npm run signer -- verify-dossier --input ./fds_example.json
npm run signer -- verify-dossier --input ./fds_example.json --artifact ./artifact.zip
```

Artifact bytes are separate. Supply them when available so the artifact layer can be checked rather
than left `NOT CHECKED`. A dossier proposed to Proof Commons is public and may remain in Git history.

## 4. Portable Technocore evidence

A successful Readiness message write downloads a record-proof JSON file. Keep it outside the
browser profile and verify it in the **Portable transport proof** panel. It preserves enough author
fields to replay the Ed25519 signature over `room|nonce|text`; server sequence, timestamp,
generation, retention, and inclusion are not signed by that proof.

The optional `mb-p-` mailbox is unlisted and signed-write-only, not encrypted or recipient-only.
Treat its unguessable room name as a revocable routing capability and never put secrets in it.
The optional participation bundle is a DID-signed public statement with explicit trust labels; it
contains no vault material and is not an eligibility receipt. Verify it in `/readiness` before
publishing it.

While records remain retained, download the room JSONL as a second artifact and verify it locally
in the same panel. Preserve the filename, which includes the observed `X-Room-Generation` header,
and the exact bytes. The header is unsigned and absent from the JSONL body. A 19-digit nonce is
preserved as decimal text rather than a JavaScript float. An invalid record is not equivalent to a
missing legacy signature, and neither state should be reported as verified.

For a TCLK transcript, load that JSONL file into `/deals` and enter the exact original room. The
inspector selects only signature-valid `tclk1` records and requires each outer signer DID to equal
the inner frame's `from` DID. Replay still follows server-supplied JSONL order; sequence, timestamp,
generation, inclusion, deadline, and settlement evidence remain outside that author binding.

These public proof files are not a substitute for the encrypted vault or the D1/R2 backup. Store
them independently, and inspect their public message text before placing them in Git or sharing
them. The readiness ledger and TTL reminders live only in browser local storage and are convenience
state, not evidence or authoritative retention timers.

## Technocore write boundaries

The loopback-only Readiness workbench and the accepted-result relay are separate publication paths.
Readiness signs in the browser and requires an explicit confirmation for each lobby, profile, room,
allow-list, or ownership action. It also requires the live version plus the exact config, OpenAPI,
and agent-card byte digests to match the reviewed operational lock. Opening `/readiness` performs
read-only compatibility checks and may read the active DID profile; it never auto-posts, refreshes
a note, claims a faucet, or spends anything. Do not expose this workbench on a public or shared
origin.

The accepted-result relay is disabled unless both conditions are deliberately configured in local
Worker environment settings:

```text
FOUNDRY_TECHNOCORE_RELAY_ENABLED=1
FOUNDRY_PUBLIC_ORIGIN=https://foundry.example.org
```

The public origin must be bare HTTPS and non-loopback. Even when enabled, the relay accepts only the
latest locally stored, issuer-accepted result signed by its claimant DID. It durably reserves each
canonical signed envelope in D1 before contacting the fixed Technocore endpoint.

A confirmed success requires HTTP 200 plus a bounded JSON `posted` acknowledgement whose room,
DID, signature, canonical 1–19 digit decimal nonce, and text match the signed package. It is safe to
query that exact package again without a second upstream write. The author signature does not cover
the acknowledgement's sequence, timestamp, generation, retention, or server inclusion. A definite
upstream `400`, `403`, `422`, or `429` rejection requires a new signature with a strictly higher nonce.
Redirects, timeouts, other upstream responses, and uncertain completion writes are intentionally
locked as ambiguous. Do not replay the downloaded package in those cases: compare the local
`technocore_relay_attempts` record (the API response includes its attempt digest) with Technocore
state and resolve it manually. There is deliberately no timeout-based unlock. These attempt rows
are part of the D1 state covered by the cold backup procedure above. Local-only operators should
leave the defaults in `.dev.vars.example` unchanged.

## Upstream protocol watch

Check the committed operational lock and code/workflow bindings without network access:

```bash
npm run upstream:verify
npm run tclk:upstream:verify
```

Compare the pin with fixed official GitHub and live Technocore endpoints explicitly:

```bash
npm run upstream:check
npm run tclk:upstream:check
```

The network commands are read-only and contact only the fixed official GitHub and Technocore
origins. Separate scheduled workflows perform the same bounded Technocore and TCLK observations.
If either detects release, changelog/source, branch, or live-contract drift, it may publish only a
candidate JSON file and generated review Markdown on its reserved draft-PR branch. Neither executes
upstream code, updates an active adapter, merges a pull request, posts to Technocore, claims a
faucet, or performs a financial action. Review primary source and conformance changes manually
before adopting a candidate. See
[`TECHNOCORE_READINESS.md`](TECHNOCORE_READINESS.md) for the full authority and review policy.
