# Foundry work/deal bundle v1

Use `/deals/bundle` to bind an existing verified Foundry dossier to an accepted TCLK
transcript and export one portable file. This is a local, unsigned container of evidence,
not a settlement rail or a new signed TCLK message type. No vault or network access is used.

## Workflow

1. Select a dossier (not a participation statement). Copy its derived `job` into a TCLK
   offer when the parties prepare that offer. Existing signed offers cannot be edited.
2. Import that deal's raw canonical `tclk1` transcript or a Technocore signed JSONL export
   with its exact room name. Both source modes are capped at 256 KiB in this bundle profile.
3. Verify the links, then download the canonical `fwd_<24-hex>.json` file.
4. Reload the file in the browser or run `npm run deal:verify -- <file>` offline.

The demo downloads use synthetic identities and a non-value paper cancellation. They
are not real work, Technocore publication, FLOP use, or contribution claims. Their raw
TCLK frames have no author signatures. They are excluded from Proof Commons.

## Exact binding

The offer uses only the existing tclk/1 job fields:

```json
{"proto":"foundry-mission-v1","id":"<mission-id>","context":"sha256:<canonical-mission-receipt-digest>"}
```

The mission receipt is found by the verified dossier's `mission.receiptId`, not by an
unverified title. Payer must equal the mission issuer DID and payee the claimant DID;
either payer- or payee-initiated offers are supported. A valid accept and contract ID
are required. Proposed-only or invalid frame chains are rejected. Terminal state is
optional and reported separately from a terminal acknowledgement receipt.

The container has exactly `schema`, `dossier`, `transcript`, and `binding` fields.
Schema is `foundry-work-deal-v1`. Dossier is its original canonical UTF-8 text;
transcript has exactly `format` (`raw` or `technocore-jsonl`), `room` (null for raw), and
`text` (original UTF-8 text). The whole wrapper is canonical JSON without a trailing LF,
using Foundry's canonical serializer. It is capped at 4 MiB; dossier at 512 KiB.

Binding records the job, complete dossier SHA-256, contract ID, transcript SHA-256,
payer/payee DIDs and exact terminal-frame digests. `contractFramesSha256` hashes validated
ASCII offer + one LF + accept, with no trailing LF. `terminalFrames` includes every
reveal/refund/cancel/receipt with its zero-based selected-frame index, type and SHA-256
of its exact `tclk1 ...` bytes (no newline). JSONL frame selection and signer binding
reuse the existing inspector. Unsigned/unrelated records are retained in the original
source, but not promoted to signed deal frames; inspect the transport ignored counts.

On import, every source is verified again and the whole binding is recomputed and
compared. The file ID uses the first 24 hex characters of the complete wrapper SHA-256;
the full digest is always reported. Filenames are conveniences, not verification inputs.

## Trust boundaries

- Valid dossier signatures do not authenticate raw TCLK authors. Signed JSONL verifies
  each selected author and its room/nonce/text binding; sequence/timestamps/generation
  remain unsigned metadata. The package does not prove venue inclusion or completeness.
- A contract commits to the mission receipt reference. The later dossier attachment
  is a local association, not evidence the counterparties agreed to that exact dossier.
- Work outcome, execution/review gaps, TCLK state and terminal receipt remain independent.
- Artifact bytes are neither embedded nor checked. Delivery content requires a separate
  artifact verification. `claimed` is not proof of final payment or quality.
- No settlement rail, signed time or deadline is checked. The wrapper adds no signature,
  timestamp authority, identity reputation or airdrop claim of its own.
- Download includes the entire selected source export; review its content before sharing.

Implementation: `lib/work-deal-bundle.ts`. Tests use independently constructed synthetic
paper frames, verify wrong-job/party/context and altered bindings, and disable `fetch`.
