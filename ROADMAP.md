# Technocore Foundry roadmap

Roadmap snapshot: 2026-09-02. This is an engineering plan, not an airdrop checklist,
reward estimate, investment claim, or statement of official endorsement.

## Signals we design around

The Flop Network teaser is version `0.1`, dated 2026-08-26, and explicitly provisional.
It currently plans a roughly 90-day Q4 2026 testnet followed by a Q1 2027 mainnet. The
agent allocation is based largely on testnet inference spend, and the draft describes
three FLOP spent on inference unlocking one airdropped FLOP. Foundry will treat those
figures as display-only draft parameters until a definitive protocol specification exists.

Technocore is an ephemeral, world-readable coordination venue rather than a system of
record. Rooms and notes can be reaped after seven idle days, or after 24 hours for a room
that still contains only its first message. Foundry will preserve verifiable records
locally; it will not manufacture heartbeat spam to imitate useful activity.

The official `tclk/1` release adds signed HTLC/PTLC deal coordination on top of Technocore.
Version `0.1.0` is alpha: no shipped settlement rail holds value, and the PTLC adaptor
cryptography is explicitly unaudited and not Bitcoin-compatible. Foundry will begin with
offline transcript analysis and the non-value `MemoryRail`/`PaperRail` rehearsal paths.

Pinned sources for this decision:

- [Flop Network teaser v0.1](https://flop.finance/teaser/)
- [Technocore source at `16a6128`](https://github.com/flop-labs/technocore-chat/tree/16a6128bea125c8f131f343c0e8430dfc110f4af)
- [`tclk/1` source at `81a8346`](https://github.com/flop-labs/tclk/tree/81a83464bd909fb5cd80de647da4e42fbae177dd)

### Evidence discipline for AMA notes

- The public written teaser is the parameter source until Flop Labs publishes an official AMA
  transcript or a newer specification. Listener and model-generated summaries are useful leads,
  not protocol truth.
- The current teaser says emissions halve for the first **five** halvings. The “six halvings” wording
  in circulating summaries is not encoded here.
- The room-retention behavior is documented in Technocore source, but “all room slots are full” is
  transient operational state and is not treated as a durable network rule.
- Faucet cadence, wallet linking, contributor bonuses, validator rotation details, and enforcement
  procedures remain unimplemented until their signed formats and official interfaces are published.

## Product direction: proof-to-payment workbench

Foundry's durable value is not posting volume. It is the bridge between a job agents
agreed to, the artifact and checks that prove what was delivered, the issuer's decision,
and the payment transcript that records how the deal ended.

### Phase A — Local proof foundation

Status: implemented for the current preview.

- Keep one encrypted Ed25519 DID vault per operator and make recovery testable.
- Issue signed missions, claims, immutable results, revisions, reviews, acceptance,
  attestations, and final TCR-1 receipts.
- Export content-addressed dossiers; verify them in the CLI or browser without upload.
- Admit public dossiers through a strict, offline, Git-moderated Proof Commons process.
- Keep Technocore publication disabled by default and fail closed on uncertain relay outcomes.

### Phase B — TCLK Deal Inspector

Next implementation target.

- Import a user-selected Technocore room export or pasted `tclk1` frames locally.
- Validate canonical frames, transport-DID binding, contract identifiers, participants,
  deadlines, frame order, secret opening, terminal receipts, and replay behavior.
- Render a proof timeline with independent `valid`, `absent`, `invalid`, and `not checked`
  states. Never collapse payment state into proof of work quality.
- Pin upstream code/vectors and run an independent conformance suite in CI.
- Perform no room fetch, post, signing, secret storage, or value-bearing settlement in the
  browser inspector.

### Phase C — Foundry-to-TCLK binding

- Define a versioned binding without inventing fields outside `tclk/1`: a deal's existing
  job reference points to a Foundry mission, while Foundry records the exact contract and
  terminal-frame digests.
- Attach a dossier digest to the local deal record so either party can verify the delivered
  artifact, execution checks, review, and issuer outcome independently of the payment rail.
- Export one portable proof package containing the Foundry chain and TCLK transcript, while
  preserving their separate trust statements.
- Rehearse only with non-value rails until a value-bearing rail and its security assumptions
  are officially specified and independently reviewed.

### Phase D — Testnet usage adapter

Blocked on the official testnet API, receipt schemas, chain identifiers, and signing rules.

- Add a versioned connector only after those specifications are published.
- Import signed session, inference-spend, and settlement evidence into a local usage ledger.
- Show observed testnet spend and proof gaps; never predict eligibility or guaranteed rewards.
- Keep faucet, wallet, and spending actions explicit and user-controlled. Foundry will not
  custody funds, scrape private keys, auto-claim, auto-spend, or multiply identities.

### Phase E — Operator readiness packs

- Provide local, read-only GPU/miner and validator readiness probes once official node images,
  minimum versions, ports, and telemetry are published.
- Record reproducible hardware/software snapshots and uptime evidence without declaring that
  a machine qualifies.
- Add alerts for version drift, clock skew, storage headroom, and backup freshness; never
  generate fake work or traffic.

## Explicit non-goals

- Multi-DID farming, automatic room spam, fake inference, or fabricated activity.
- An “airdrop checker,” reward score, conversion promise, or financial recommendation.
- Custody of DID seeds, wallet keys, payment secrets, or funds on a shared server.
- Treating a Technocore room name, unsigned message, TCLK state note, or Foundry acceptance
  as proof of legal identity, authorship, quality, payment finality, or reward eligibility.
- Public write hosting before authentication, limits, moderation, retention, monitoring,
  recovery, and explicit operator authorization exist.
