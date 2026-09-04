# Reproducible verification

Release-rehearsal versions: Node.js 22.13.0 from `.node-version` and Python 3.12.10 from
`.python-version`, with the exact direct Python dependency in `requirements-dev.txt`.

```sh
npm ci
npm run protocol:generate
npm run commons:build
npm run db:generate
npm run lint
npx tsc --noEmit
npm run build
npm run test:migrations
npm run test:protocol
npm run test:signer
npm run test:observer
npm run test:security:unit
npm run test:relay
npm run commons:verify
npm run commons:check
npm run test:commons
npm run test:inspector
npm run test:tclk
npm run test:technocore
npm run test:participation
npm run upstream:verify
npm run tclk:upstream:verify
npm run test:onboarding
npm audit --omit=dev
git diff --exit-code -- protocol/fixtures/v1.json public/commons/index.json drizzle
npm run release:artifacts
git diff --exit-code -- release/manifest.json release/sbom.cdx.json release/licenses.json
```

With the local preview running on port 3000:

```sh
npm run test:security
npm run test:smoke
```

Generate all source-derived fixtures and migrations before the release artifacts; the manifest is
deliberately last. `release/manifest.json` content-addresses every release input plus the protocol
fixture, package lock, Commons index/verifier, relay boundary, every SQL migration and Drizzle
metadata file, SBOM, dependency-license report, root license and notice, fixed Technocore lane, and
the reviewed operational Technocore lock/commit. The historical fixture source pin remains distinct
from this live adapter pin. Its release-input-set digest is derived from canonical path, Git mode, and
SHA-256 records for the committed source index; generation fails when non-release inputs are unstaged
or untracked.

`npm run upstream:verify` and `npm run tclk:upstream:verify` are deterministic and offline. Do not
put their `*:check` counterparts in the reproducible recipe: they intentionally read mutable
official metadata and live Technocore contract documents, so their results are operational drift
observations rather than reproducible build inputs.

Run this recipe from a clean committed checkout; it never mutates the Git index. When authoring a
release, review and commit named source paths first, generate the three release files, review them,
and commit those files separately. Never use a blanket staging command for release preparation.
`release/licenses.json` is a deterministic inventory derived from the lockfile; `NOASSERTION`
requires manual review before distributing a compiled bundle. These are unsigned build artifacts,
not operator signatures or endorsements.
