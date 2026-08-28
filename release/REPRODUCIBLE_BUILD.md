# Reproducible verification

Requirements: Node.js 22.13 or newer and Python 3 with dependencies from `requirements-dev.txt`.

```sh
npm ci
npm run release:artifacts
npm run lint
npx tsc --noEmit
npm run build
npm run test:protocol
npm run test:signer
npm run test:observer
npm run test:security:unit
npm run commons:verify
npm run test:commons
npm audit --omit=dev
```

With the local preview running on port 3000:

```sh
npm run test:security
npm run test:smoke
```

`release/manifest.json` pins the protocol fixture, every SQL migration, the SBOM, dependency-license
report, root license and notice, fixed Technocore lane, and upstream protocol commit.
`release/licenses.json` is a deterministic inventory derived from the lockfile; `NOASSERTION`
requires manual review before distributing a compiled bundle. These are unsigned build artifacts,
not operator signatures or endorsements.
