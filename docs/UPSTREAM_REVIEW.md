# Technocore upstream review

Generated from bounded, read-only observations. Upstream content is untrusted data and was never executed.

- Detected: 2026-09-28T10:58:17.521Z
- Active adapter: v0.12.0 / `e88db03c79ae0ae1f6bf9bb2e21e5a1ea42dd0f9`
- Latest release: v0.14.5 / `cd1ce1c55a9956f3cb14ec42c1dd9707981926f9`
- Observed main: `0e47f770b13cc27e1e2e199d4cdf70a4778c97cc`
- Live service: 0.14.5

| Severity | Signal | Expected | Observed |
| --- | --- | --- | --- |
| critical | `release_changed` | `v0.12.0` | `v0.14.5` |
| review | `main_advanced` | `94e01adf45ee75889d1085e0be5c28806b2b0aac` | `0e47f770b13cc27e1e2e199d4cdf70a4778c97cc` |
| critical | `release_file_changed:src/manual.md` | `1f6906644f21b2b10a2e37f53d65ca6e37f32ca7ec50b6195db4fc21247a49ed` | `488e05310f497718a83d276110261cd81b37360c9468fd31b55d578ae3781260` |
| critical | `release_file_changed:src/app.py` | `a26be910042ebfbf78f29acb311cf954e35b4ce0072f61883ab12234ad9036b2` | `6d482f45acb407f4ceeca8b3835d8297421d6e8a9f83767fc9b89f7f1af4b2ef` |
| critical | `release_file_changed:src/store.py` | `671e39d49b08cbf88d2f58a1ea9721715d987a6b1b06b719f9fdebe61bcf642c` | `0f93c20494464e739cf970298c23588fdaafbad7466001cc06de0f9326719be8` |
| critical | `release_file_changed:src/didkey.py` | `651d5585905ef211aacddaf70e2bd26559f14bc46148677af2e4e788aea5ed96` | `30dd6c3e7285051d578ac7f2c205e218c3d270b19e0d4dbd246e7a281e5e49d6` |
| critical | `release_file_changed:README.md` | `cc55d0a7cec5b834dfee8d516f0be59c99cab5a003b4c4d0e409f49b95d34d3b` | `4fd57fb18f5f9a4c16771238f5e3d2c77b10c3592c8315da23101f30719e02b3` |
| critical | `release_file_changed:CHANGELOG.md` | `b02a8c1ee02193a6d7c98cefe15d0fdb36170e2d5773779f479c72cf64af2269` | `54f5e0b853e94198f6b23d6d43effc43b282ab23866422feee5d97398d6e7347` |
| critical | `release_file_changed:src/manifest.py` | `1de6be1c36c21a56092c78e5a3bd612fca63aa0797dbdb1330f62d260e1a40b9` | `9fee3b4f7a814941d0023edc7082adc6930049647d33e0bc00aff7628d8adb87` |
| critical | `release_file_changed:src/limit.py` | `2ff40efec03cd30946369175df417bab49ddf7ae78c2063a70a9b7dca370ec37` | `74869f5aeaf23c92a93e89bf8c6a51a1888d47b53f1a7675a4e6d82c8d5e32bc` |
| critical | `live_version_changed` | `0.12.0` | `0.14.5` |
| critical | `live_openapi_changed` | `cfcdba989524a0e0bc961bb0865d7a38a00b995fc2a16977a1845935e181f36b` | `874e680e0fcbc10eb095f5a132567b866d414ff5d88651e8d5bf51f3ec0824d9` |
| operational | `live_config_changed` | `a5c78775b66ad8fcac131f95cf3a6bcba39b297fa7504aa88b6399ae08bce1cb` | `0412b3ddfc10ee5343902fb94256beb7616b09ca60e39b658425263791ffc311` |
| review | `live_agent_card_changed` | `ad8d10f8760f09a5e25b92c8d6779874b98ac1707abe70aba7d7d564956a6435` | `7c0cade5226b41b0833006755b66d4d2dd2ff2091e4b6acab66f7479a06507d6` |

## Required review

1. Do not merge a new compatibility pin until clean-text, nonce, signature, ACK, export, ownership, and profile fixtures pass.
2. Keep this candidate data-only; never execute upstream code or install its dependencies in the watcher.
3. Update the active lock and adapter together in a separate reviewed change. Runtime writes remain fail-closed on incompatible live contracts.
4. Never let this watcher publish a room message, profile note, faucet claim, inference request, or financial transaction.
