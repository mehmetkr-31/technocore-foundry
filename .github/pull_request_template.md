## Why and what changed

<!-- Describe the problem, the bounded change, and any intentionally deferred work. -->

## Trust-boundary impact

- Protocol or canonical bytes:
- DID/signing/key handling:
- Storage or migration:
- External reads or writes:
- Public proof or moderation:

## Verification evidence

<!-- List exact commands and concise results. Do not paste secrets or private transcripts. -->

## Generated artifacts and provenance

<!-- List regenerated files and the origin/license of copied or generated material. -->

## Checklist

- [ ] This change contains no vault, private key, passphrase, token, `.dev.vars`, personal data, or unpublished receipt.
- [ ] Tests perform no external write, DID registration, Technocore publication, or loopback receipt announcement.
- [ ] Protocol and trust-boundary changes include documentation and adversarial tests.
- [ ] Database migrations are append-only and generated artifacts are in sync.
- [ ] Third-party and generated material has documented provenance and compatible licensing.
- [ ] I understand that merging does not establish identity, authorship, reward, or airdrop eligibility.

### Proof Commons submissions only

- [ ] This PR adds exactly one canonical `commons/dossiers/fds_<24hex>.json` file and changes nothing else.
- [ ] The dossier contains only intentionally public data and I approve its permanent public inclusion.
- [ ] `npm run commons:verify` and `npm run test:commons` pass without network access.
