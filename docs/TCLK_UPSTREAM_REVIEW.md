# TCLK upstream review

Generated from bounded, read-only observations. Upstream content is untrusted data and was never executed.

- Detected: 2026-10-23T09:33:09.557Z
- Active adapter: `5cc4ab93efbc8999a3a7e1471b639deca25998ea`
- Latest release: v0.1.0 / `54e5caf03da76cd6c3d412ab840f543be018734b`
- Observed main: `fb910d354b34892f9bad236ca51f390be50a6d4b`

| Severity | Signal | Expected | Observed |
| --- | --- | --- | --- |
| review | `main_advanced` | `5cc4ab93efbc8999a3a7e1471b639deca25998ea` | `fb910d354b34892f9bad236ca51f390be50a6d4b` |
| critical | `file_changed:SPEC.md` | `f01b46edf747606402979e5bf09193e3d7032217461bf5af2135241e5d940b62` | `a5d809c2d5e2203f09cfcc184c523120209cb2485f454861773c3def3fb82962` |
| critical | `file_changed:README.md` | `25fdc211f4b23cad0473fd5177d20f77e7e3e39825ee1c81188abbdf432d5d06` | `d670cad5466bdc00dca6fb3436977b128e881286347b9e2af4af52f3af95c1f1` |
| critical | `file_changed:CHANGELOG.md` | `09d36504a4fc0026b982470a3e7bf2699ce862c7c7b3f160757d0574a0774110` | `8dde8a936e5af3068db7c958cfb9af2e7da0eda7a68207ab6c374e9b9ad0c92b` |

## Required review

1. Keep this candidate data-only. Never execute TCLK upstream code or install its dependencies in this watcher.
2. Compare SPEC, frame shapes, canonical bytes, id commitments, state transitions, contradictory receipts, and official vectors.
3. Update the lock and local inspector together only after conformance tests pass. Never auto-merge a protocol change.
4. This watcher must never publish an offer, room message, settlement instruction, faucet claim, inference request, or financial transaction.
