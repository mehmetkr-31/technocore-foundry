# Technocore 0.12.0 compatibility review

Reviewed on 2026-09-05 against official tag `v0.12.0`, commit
`e88db03c79ae0ae1f6bf9bb2e21e5a1ea42dd0f9`. The GitHub latest-release object still
names `v0.11.4`; this pin is explicitly `official-reviewed-tag`, not a claim that
a 0.12.0 GitHub release object exists.

## Reviewed changes

- `src/didkey.py` is unchanged. Message and ownership-note signing templates,
  canonical signature encoding, nonce ordering, stored clean text, acknowledgement
  shape, JSONL export and generation header remain compatible.
- `src/config.py` adds `CHAT_STILLBORN_SECONDS`, default 86400, minimum 3600.
  The captured official deployment uses 43200 seconds (12 hours). Foundry's reminder
  uses this reviewed deployment value; answered rooms and ordinary notes retain the
  seven-day idle window. Future configuration drift blocks writes pending review.
- `src/app.py`, `src/manifest.py` and `src/limit.py` change duplicate-422 guidance
  and add an optional diagnostic ref token. Duplicate normalization ignores that token;
  signed/stored text normalization does not change. Foundry does not retry or reword
  refused posts automatically and does not add diagnostic tokens.
- Store append and edge caching changes do not change the supported response shapes.
  This review does not add MCP or edge-deployment management to Foundry.

## Foundry corrections

The readiness status handler formerly fed `/config` into the integer-only signed-payload
parser. A legitimate fractional `wait_poll: 0.5` therefore appeared offline. Config now
uses standard JSON decoding after strict UTF-8 decoding; only its version is read for
display. Compatibility still requires the version and the SHA-256 of every exact config,
OpenAPI and agent-card document to match the reviewed lock. Signed inputs retain the
strict parser. A document with different bytes, including duplicate keys or changed
settings, cannot enable writes.

The upstream watcher observes the newer of the published release and live service
version, resolves the exact tag only in `flop-labs/technocore-chat`, and inspects files
at its commit. A missing tag fails observation rather than inventing provenance.
Tag movement, source changes and live-document drift remain review signals. Config,
manifest and duplicate-limit source files now join the watched file list. Observations
remain data-only; adoption and merging are never automatic.

## Evidence and validation

The unmodified public documents in `protocol/upstream/technocore-live/` were downloaded
from `https://technocore.chat/config`, `/openapi.json` and `/.well-known/agent.json`.
Their byte hashes are pinned in the operational lock. They originate from the official
Apache-2.0 Technocore project and are test data, never executable code.

`test:technocore` replays those exact bytes and checks positive compatibility plus
independent drift in all three documents, the 12-hour reminder, release/tag selection,
and the existing signature/nonce/ACK/export/ownership/profile boundaries. Historical
protocol signing fixtures retain their original provenance.

## Pending operator action

No real Technocore message was sent during this change. The operator must unlock the
existing DID locally and explicitly publish the contribution announcement. The existing
public participation bundle remains valid; it is not a server acknowledgement.
