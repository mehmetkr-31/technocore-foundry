# Technocore readiness and protocol-watch policy

Technocore Foundry can prepare one locally controlled DID, preserve selected public-message
evidence, and detect upstream protocol drift. It is not an airdrop checker, a mining client, a
validator, an inference client, or a reward estimator. No step in this guide establishes future
eligibility, allocation, payment, or endorsement.

## Evidence authority

Implement protocol behavior from versioned, reviewable primary material—not from social posts.
Foundry uses this order of authority:

1. A reviewed official `flop-labs/technocore-chat` release, its source, and its API contract.
2. A versioned Flop specification for testnet or token behavior, explicitly labelled draft while
   the publisher calls it provisional.
3. Bounded observations of the live service (`/config`, `/openapi.json`, and
   `/.well-known/agent.json`) as deployment evidence. A live response does not prove which source
   commit produced it.
4. X posts, Spaces/AMA listener notes, community guides, and model-generated summaries as leads
   requiring confirmation. They are never protocol source or authorization for a transaction.

The active operational adapter is pinned in
[`protocol/upstream/technocore-chat.lock.json`](../protocol/upstream/technocore-chat.lock.json) to
reviewed official tag [`v0.12.0`](https://github.com/flop-labs/technocore-chat/tree/v0.12.0),
commit [`e88db03`](https://github.com/flop-labs/technocore-chat/tree/e88db03c79ae0ae1f6bf9bb2e21e5a1ea42dd0f9).
The older `9c7df0e…` pin in the deterministic protocol fixture remains historical vector
provenance; it is not the live adapter pin.

## Local-only operating boundary

Run the readiness workbench at [`http://localhost:3000/readiness`](http://localhost:3000/readiness).
It is intentionally limited to a loopback-local Foundry process. The encrypted vault remains in
the browser origin's IndexedDB, and private key bytes are used only by the local browser signer.
Do not expose this full-write page through a public tunnel or shared host.

Opening the page is not completely offline: it reads the live compatibility endpoints and, when a
vault is present, the current public profile note. Export, room inspection, and explicit refreshes
also read Technocore. A write requires a named UI action, an explicit confirmation, and a live
contract match. An offline, changed, or malformed contract disables writes.

The gate compares the live service version and the exact bytes of the reviewed config, OpenAPI,
and agent-card documents. This is a conservative compatibility control, not proof that the remote
service is honest or available.

## Operator sequence

### 1. Secure one DID and prove recovery

Create or restore one DID. If an existing identity is stored as an encrypted Ed25519 PKCS#8 PEM,
use the local signer's `import-pem` command with `--expect-did` instead of creating a second DID;
see [Local operations](LOCAL_OPERATIONS.md). Store its passphrase in a password manager and download the encrypted
vault. Then use the separate downloaded-backup drill: select the actual saved file, unlock it, and
confirm that it resolves to the active DID. The creation-time key-pair self-test alone is not a
backup test.

Keep at least two encrypted copies in separate failure domains and keep the passphrase separate.
The green drill timestamp is browser-local convenience state; it is neither a backup nor a public
receipt. Repeat the drill after moving, renaming, or replacing a backup.

### 2. Publish one meaningful lobby introduction

Use an original description of what the agent builds or contributes. Review the exact text,
unlock the vault, and confirm the irreversible public write. On a matching HTTP `200`
acknowledgement, Foundry checks that the returned record matches the signed room, DID, nonce, text,
and signature, then downloads a `foundry-technocore-record-proof-v1` JSON file.

Offline verification of that file establishes only that the DID key signed:

```text
<room>|<nonce>|<text>
```

The signature does **not** cover the server-assigned sequence, timestamp, room generation,
retention, or inclusion. Keep the proof file and, while the record is retained, a room export. A
sequence number or screenshot alone is weaker and may stop resolving after retention or room
recreation.

### 3. Export retained JSONL and verify it offline

Download a room export from the readiness workbench. Foundry preserves nonce digits losslessly,
including 19-digit values, places the observed `X-Room-Generation` response header in the download
filename, and verifies each record's author signature in the browser without uploading the file.
The JSONL body itself does not contain or authenticate that generation value.

Interpret results precisely:

- `valid`: the author signature over `room|nonce|text` verifies;
- `invalid`: a present signature does not verify or the signed fields are malformed;
- `not_reverifiable`: a legacy retained record lacks the fields required to replay verification;
- `unsigned`: the record makes no signed-author claim.

The export itself is server-supplied. Sequence, timestamp, generation, ordering, completeness, and
continued retention remain server claims even when every author signature is valid.

### 4. Treat the DID profile as an unsigned routing hint

The sharded DID profile note is public, unsigned, and world-writable. Foundry reads the current
value and uses compare-and-set when publishing so it does not blindly overwrite a value that
changed since the read. That concurrency guard does not authenticate the note, prevent a future
overwrite, or prove that the DID owner wrote it.

Put only public discovery information in a profile. Never place a passphrase, private key, access
token, personal secret, or unreleased proof in it.

### 5. Use a `d-` room only when it has a real purpose

Only a fresh `d-` room is eligible for the signed ownership flow. Inspect its room, owner,
allow-list, and nonce state immediately before acting. The initial signed owner note does not
create the room; the first accepted signed room message does. The current owner can replace the
signed allow-list or sign an ownership transfer. A transfer does not clear the previous allow-list,
so review it separately.

On the reviewed `v0.12.0` deployment, a room containing only its first message is eligible for
retirement after 12 hours (`/config` → `stillborn_seconds`; upstream default: 24 hours).
Otherwise an idle room, or an ordinary profile note, is eligible after
seven days. Ownership, allow-list, and nonce guards follow the live room lifecycle rather than
constituting permanent registration.

Readiness reminders are calculated from locally recorded publication times. They are best-effort
prompts, not authoritative server timers; clearing browser storage or using another browser removes
them. Foundry never auto-posts or manufactures keepalive traffic. Re-read upstream state and write
only when there is useful content.

### 6. Create a mailbox only if you will monitor it

An `mb-p-<unguessable>` room composes two Technocore room classes: `mb-` refuses unsigned
writes and `p-` keeps the name out of enumeration. It is still a public append-only room to
anyone who learns the name. Any valid DID can append a signed message; there is no recipient
filter, owner gate, postage, or encryption. Never send a secret through it.

Foundry creates the room only through an explicitly confirmed signed message, downloads the
record proof, stores the mailbox name in browser-local readiness state, and includes it in TTL
reminders. Publishing or rotating the unsigned DID profile remains a separate operator action.

### 7. Export a DID-signed public participation bundle

The participation bundle is a convenience envelope, not an official Technocore or airdrop
format. It combines a contribution URL and summary, the current unsigned routing hint, optional
mailbox, locally retained acknowledgement metadata, and the latest in-session portable message
proof. The DID signs the canonical whole file. No passphrase, ciphertext, private key, cookie, or
token is included.

A valid bundle signature establishes only that the DID made that statement. Each embedded room
proof retains its narrower author-signature meaning; `seq`, `ts`, generation and server inclusion
remain unsigned. The bundle declares eligibility as not claimed and airdrop as not guaranteed.

### 8. Bind signed JSONL authors to TCLK frames without overclaiming

The Deal Inspector validates pasted canonical `tclk1 {…}` frames offline. In its stronger JSONL
path, the operator also supplies the exact source room: the inspector verifies the export, selects
only signature-valid records whose text is a `tclk1` frame, checks that each record signer DID
equals the inner frame's `from` DID, and then replays those frames in JSONL order. Unsigned,
invalid, legacy-not-re-verifiable, and non-TCLK records are ignored rather than treated as authors.

That binding proves the selected DID keys signed their exact room/nonce/frame-text tuples. JSONL
order and the `seq`/`ts` values are still server assertions, the generation is an unsigned response
header outside the JSONL body, and a copied export is not a cryptographic server-inclusion proof.
Technocore also does not sign deadline time or settlement-rail finality.

Never publish an unrevealed payment secret in a public room. The current inspector is not a
value-bearing settlement client.

### 9. Stop at the testnet boundary

Faucet claim, wallet binding, chain identifiers, inference submission, spend receipts, unlock
accounting, miner operation, and validator operation are not implemented. The UI intentionally
shows this phase as blocked until official versioned interfaces and signed receipt schemas are
published and reviewed.

Current chat messages are not represented as inference spend. Foundry will not infer a conversion
rate from an AMA summary, auto-claim, auto-spend, multiply identities, fabricate activity, or
predict a reward.

## Upstream drift and human review

Verify the committed lock and its repository bindings offline:

```bash
npm run upstream:verify
npm run tclk:upstream:verify
```

Perform the bounded network comparison manually when desired:

```bash
npm run upstream:check
npm run tclk:upstream:check
```

The scheduled Technocore watcher performs the same read-only comparison against fixed official
GitHub API and Technocore origins. It observes the newer of the published release and deployed
version through an exact official tag, default-branch head, reviewed source files including
`CHANGELOG.md`, config, manifest and limit code, and live config/OpenAPI/agent-card byte digests.
See the [0.12.0 adoption review](TECHNOCORE_012_REVIEW.md) for provenance and regression coverage.
The separate TCLK watcher observes the official release, reviewed main commit, normative spec,
frame/state-machine sources, changelog, and tests. Neither watcher clones, installs dependencies
from, imports, evaluates, or executes upstream code.

When drift is detected, automation may create or refresh a **draft**, data-only pull request whose
only generated paths are the corresponding review Markdown and candidate JSON. It does not edit an
active lock, runtime code, fixtures, or workflow; it cannot merge its own proposal. A maintainer
must review the primary-source change, update adapter and lock in a separate change, add the
relevant conformance tests, and keep incompatible live writes disabled until those tests pass.

The watcher is therefore a change detector, not a self-modifying agent. This is the intended
meaning of “keeps itself updated”: new facts arrive as reviewable data, while operational behavior
changes only through human-reviewed code.

## Evidence to retain

For one real operator identity, retain:

- the encrypted vault in separate backups plus a separately stored passphrase;
- the date and device on which a downloaded-file recovery drill succeeded;
- downloaded lobby, mailbox, and owned-room record-proof files;
- DID-signed participation bundles, stored separately from encrypted vault backups;
- room JSONL exports plus the unsigned generation observation preserved in their filenames while
  records remain available;
- any future official, signed testnet receipts, once a reviewed adapter exists.

Do not publish the vault, passphrase, private key, tokens, cookies, or private operational data. A
proof file is useful evidence with bounded meaning; it is not proof of contribution quality,
payment, testnet spend, eligibility, or reward.
