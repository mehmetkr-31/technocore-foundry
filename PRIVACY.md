# Privacy boundary

Foundry does not request an email address, wallet, legal name, or account profile.

The browser stores an encrypted local DID vault in IndexedDB. Foundry servers receive public DIDs,
signed public events, receipt metadata, uploaded contribution artifacts, and user-triggered public
evidence snapshots. Private key bytes and vault passphrases are not sent to the server.

The loopback-only Readiness page performs a live compatibility read when opened and, when a vault
is present, reads that DID's public profile note. Explicit export and room-inspection actions make
additional public reads. Its local API receives only already-signed public message/note envelopes
or an explicitly confirmed unsigned public profile value; signing and backup-file recovery happen
in the browser. The downloaded-backup drill does not upload the vault or passphrase.

A readiness ledger in browser local storage records the active public DID, successful backup-drill
time, profile-publication time, and bounded room/sequence/generation/publication-time reminders. It
is not synchronized, is not proof, and disappears if that browser origin's storage is cleared.
Selected record-proof, JSONL, and TCLK files are verified in volatile browser memory and are not
uploaded. A requested live JSONL export passes through the fixed-origin local adapter so the exact
bytes can be downloaded; Foundry does not retain that body server-side.

The fixed-lane observer stores sequence and epoch metadata, a bounded actor hint, message SHA-256,
and a safe Foundry receipt identifier when present. It does not store or render the remote message
text and does not fetch URLs found in messages.

When an operator explicitly enables the publication relay, D1 stores a durable attempt record with
the public claimant DID, fixed room, normalized nonce, result identifier, envelope/text SHA-256
digests, upstream status plus a fixed outcome classification, and reservation/completion timestamps. This record prevents
unsafe replay after an uncertain network outcome. It contains no private key, passphrase, raw vault,
request header, or wallet data.

The scheduled Technocore and TCLK upstream watchers read bounded public official metadata and
Technocore contract documents. On drift they may place hashes, versions, source-file metadata, and
contract-difference reasons in a public draft pull request. They do not collect a DID or execute
the fetched upstream code.

Contribution dossiers embed only those public receipts, public evidence metadata, and artifact
digests. They do not embed artifact bytes, raw GitHub API responses, command transcripts, local
paths, request headers, observer message text, vaults, passphrases, or private keys.

A dossier proposed to Proof Commons is intentionally public and content-addressed. Git history may
retain its exact bytes even if maintainers later remove or quarantine it from the derived index.
Submitters must not include personal data, secrets, credential-bearing/internal-network URLs, or
material they are not permitted to publish. A tightly bounded loopback artifact reference may be
preserved as nonportable signed context, but is never rendered or fetched. Commons validation
performs no URL fetch and does not host artifact bytes.

The Local Proof Inspector reads a user-selected dossier and optional artifact only into volatile
browser memory. It does not upload, persist, or transmit those files and never opens or fetches any
URL contained in the dossier. Closing or resetting the inspector discards its in-memory selection.

All accepted contributions, receipts, and dossiers are designed to be shareable public proof if
the operator later enables public access. The current deployment remains owner-only.
