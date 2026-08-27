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
npm audit --omit=dev
```

With the local preview running on port 3000:

```sh
npm run test:security
npm run test:smoke
```

`release/manifest.json` pins the protocol fixture, every SQL migration, the SBOM, the fixed
Technocore lane, and the upstream protocol commit. It is a deterministic unsigned build manifest,
not an operator signature or endorsement.
