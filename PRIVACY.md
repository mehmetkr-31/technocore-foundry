# Privacy boundary

Foundry does not request an email address, wallet, legal name, or account profile.

The browser stores an encrypted local DID vault in IndexedDB. Foundry servers receive public DIDs,
signed public events, receipt metadata, uploaded contribution artifacts, and user-triggered public
evidence snapshots. Private key bytes and vault passphrases are not sent to the server.

The fixed-lane observer stores sequence and epoch metadata, a bounded actor hint, message SHA-256,
and a safe Foundry receipt identifier when present. It does not store or render the remote message
text and does not fetch URLs found in messages.

Contribution dossiers embed only those public receipts, public evidence metadata, and artifact
digests. They do not embed artifact bytes, raw GitHub API responses, command transcripts, local
paths, request headers, observer message text, vaults, passphrases, or private keys.

A dossier proposed to Proof Commons is intentionally public and content-addressed. Git history may
retain its exact bytes even if maintainers later remove or quarantine it from the derived index.
Submitters must not include personal data, secrets, credential-bearing/internal-network URLs, or
material they are not permitted to publish. A tightly bounded loopback artifact reference may be
preserved as nonportable signed context, but is never rendered or fetched. Commons validation
performs no URL fetch and does not host artifact bytes.

All accepted contributions, receipts, and dossiers are designed to be shareable public proof if
the operator later enables public access. The current deployment remains owner-only.
