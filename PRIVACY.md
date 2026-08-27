# Privacy boundary

Foundry does not request an email address, wallet, legal name, or account profile.

The browser stores an encrypted local DID vault in IndexedDB. Foundry servers receive public DIDs,
signed public events, receipt metadata, uploaded contribution artifacts, and user-triggered public
evidence snapshots. Private key bytes and vault passphrases are not sent to the server.

The fixed-lane observer stores sequence and epoch metadata, a bounded actor hint, message SHA-256,
and a safe Foundry receipt identifier when present. It does not store or render the remote message
text and does not fetch URLs found in messages.

All accepted contributions and receipts are designed to be shareable public proof if the operator
later enables public access. The current deployment remains owner-only.
