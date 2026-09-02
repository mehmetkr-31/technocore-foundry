import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const maximumReleaseInputBytes = 100 * 1024 * 1024;
const readIndexedBlob = (objectId, path) => {
  const sizeText = execFileSync('git', ['cat-file', '-s', objectId], { cwd: root, encoding: 'utf8' }).trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > maximumReleaseInputBytes) {
    throw new Error(`Release input ${path} exceeds the 100 MiB per-file boundary.`);
  }
  const bytes = execFileSync('git', ['cat-file', 'blob', objectId], {
    cwd: root,
    maxBuffer: maximumReleaseInputBytes + 1024,
  });
  if (bytes.byteLength !== size) throw new Error(`Release input ${path} was not read completely.`);
  return bytes;
};
const generatedReleasePaths = new Set(['release/manifest.json', 'release/sbom.cdx.json', 'release/licenses.json']);
const splitNul = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);
const untrackedInputs = splitNul(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }))
  .filter((path) => !generatedReleasePaths.has(path));
const unstagedInputs = splitNul(execFileSync('git', ['diff', '--name-only', '-z'], { cwd: root }))
  .filter((path) => !generatedReleasePaths.has(path));
if (untrackedInputs.length || unstagedInputs.length) {
  throw new Error(`Release inputs must be staged before generation (untracked: ${untrackedInputs.length}, unstaged: ${unstagedInputs.length}).`);
}
const releaseInputSet = splitNul(execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root }))
  .map((entry) => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[3] !== '0') throw new Error('Release input index contains an unsupported or conflicted entry.');
    return { mode: match[1], objectId: match[2], path: match[4] };
  })
  .filter(({ path }) => !generatedReleasePaths.has(path))
  .sort((left, right) => compareCodeUnits(left.path, right.path))
  .map(({ mode, objectId, path }) => ({
    path,
    mode,
    sha256: digest(readIndexedBlob(objectId, path)),
  }));
const releaseInputSetSha256 = digest(Buffer.from(JSON.stringify(releaseInputSet), 'utf8'));
const lockBytes = await readFile(`${root}/package-lock.json`);
const lock = JSON.parse(lockBytes.toString('utf8'));
const packageJson = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
const releaseVersion = packageJson.version;
const componentsByReference = new Map();
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path.includes('node_modules/') || !entry?.version) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const encodedName = name.split('/').map(encodeURIComponent).join('/');
    const reference = `pkg:npm/${encodedName}@${entry.version}`;
    const candidate = {
      type: 'library',
      'bom-ref': reference,
      name,
      version: entry.version,
      purl: reference,
      scope: entry.dev || entry.optional || entry.devOptional ? 'optional' : 'required',
      licenses: [{ expression: entry.license ?? 'NOASSERTION' }],
    };
    const existing = componentsByReference.get(reference);
    if (!existing || (existing.scope === 'optional' && candidate.scope === 'required')) componentsByReference.set(reference, candidate);
  }
const components = Array.from(componentsByReference.values()).sort((left, right) => compareCodeUnits(left['bom-ref'], right['bom-ref']));

const serialHex = digest(Buffer.concat([Buffer.from(`technocore-foundry@${releaseVersion}\0`), lockBytes])).slice(0, 32).split('');
serialHex[12] = '5';
serialHex[16] = ((Number.parseInt(serialHex[16], 16) & 0x3) | 0x8).toString(16);
const serial = `${serialHex.slice(0, 8).join('')}-${serialHex.slice(8, 12).join('')}-${serialHex.slice(12, 16).join('')}-${serialHex.slice(16, 20).join('')}-${serialHex.slice(20).join('')}`;
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${serial}`, version: 1,
  metadata: { component: { type: 'application', 'bom-ref': `pkg:npm/technocore-foundry@${releaseVersion}`, name: 'technocore-foundry', version: releaseVersion, licenses: [{ license: { id: 'Apache-2.0' } }] } },
  components,
};

await mkdir(`${root}/release`, { recursive: true });
await writeFile(`${root}/release/sbom.cdx.json`, `${JSON.stringify(sbom, null, 2)}\n`);
const dependencyLicenses = {
  schema: 'technocore-foundry-dependency-licenses-v1',
  projectLicense: 'Apache-2.0',
  packages: components.map((component) => ({
    name: component.name,
    version: component.version,
    scope: component.scope,
    license: component.licenses[0].expression,
  })),
};
await writeFile(`${root}/release/licenses.json`, `${JSON.stringify(dependencyLicenses, null, 2)}\n`);
const fixtureBytes = await readFile(`${root}/protocol/fixtures/v1.json`);
const sbomBytes = await readFile(`${root}/release/sbom.cdx.json`);
const licenseReportBytes = await readFile(`${root}/release/licenses.json`);
const licenseBytes = await readFile(`${root}/LICENSE`);
const noticeBytes = await readFile(`${root}/NOTICE`);
const localOperationsBytes = await readFile(`${root}/docs/LOCAL_OPERATIONS.md`);
const roadmapBytes = await readFile(`${root}/ROADMAP.md`);
const relayPolicyBytes = await readFile(`${root}/lib/technocore-relay-policy.ts`);
const relayServiceBytes = await readFile(`${root}/lib/technocore-relay-service.ts`);
const relayStoreBytes = await readFile(`${root}/db/technocore-relay-attempts.ts`);
const relayRouteBytes = await readFile(`${root}/app/api/technocore/publish/route.ts`);
const browserVerifierBytes = await readFile(`${root}/lib/browser-dossier-verifier.mjs`);
const commonsRegistryBytes = await readFile(`${root}/scripts/commons-registry.mjs`);
const commonsIndexBytes = await readFile(`${root}/public/commons/index.json`);
const migrations = (await readdir(`${root}/drizzle`)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const migrationDigests = Object.fromEntries(await Promise.all(migrations.map(async (name) => [name, digest(await readFile(`${root}/drizzle/${name}`))])));
const drizzleMetadata = (await readdir(`${root}/drizzle/meta`)).filter((name) => /^(?:_journal|\d{4}_snapshot)\.json$/.test(name)).sort();
const drizzleMetadataDigests = Object.fromEntries(await Promise.all(drizzleMetadata.map(async (name) => [name, digest(await readFile(`${root}/drizzle/meta/${name}`))])));
const manifest = {
  schema: 'technocore-foundry-release-manifest-v2',
  version: releaseVersion,
  sourceRepository: packageJson.repository.url,
  releaseInputSetSha256,
  releaseInputCount: releaseInputSet.length,
  access: 'owner-only',
  publicWrite: 'disabled-until-explicit-operator-action',
  technocore: {
    origin: 'https://technocore.chat', room: 'foundry-contributions',
    sourceCommit: '9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c',
    relayAcknowledgementSourceCommit: '16a6128bea125c8f131f343c0e8430dfc110f4af',
    observationTrust: 'transport_unverifiable',
  },
  artifacts: {
    protocolFixtureSha256: digest(fixtureBytes),
    packageLockSha256: digest(lockBytes),
    sbomSha256: digest(sbomBytes),
    dependencyLicensesSha256: digest(licenseReportBytes),
    licenseSha256: digest(licenseBytes),
    noticeSha256: digest(noticeBytes),
    localOperationsSha256: digest(localOperationsBytes),
    roadmapSha256: digest(roadmapBytes),
    technocoreRelayPolicySha256: digest(relayPolicyBytes),
    technocoreRelayServiceSha256: digest(relayServiceBytes),
    technocoreRelayStoreSha256: digest(relayStoreBytes),
    technocoreRelayRouteSha256: digest(relayRouteBytes),
    browserDossierVerifierSha256: digest(browserVerifierBytes),
    commonsRegistrySha256: digest(commonsRegistryBytes),
    commonsIndexSha256: digest(commonsIndexBytes),
    migrationSha256: migrationDigests,
    drizzleMetadataSha256: drizzleMetadataDigests,
  },
  requiredGitHubContexts: ['Lint, typecheck, build', 'Cross-language protocol', 'Signer, observer, security, Commons', 'Local HTTP boundary', 'Release artifact drift'],
  expectedVerificationGates: ['lint', 'typescript', 'build', 'migration-generation-drift', 'blank-migration-apply', 'protocol-ts', 'protocol-python', 'signer', 'dossier-offline', 'commons-offline', 'browser-verifier-unit-parity', 'local-doctor', 'observer', 'durable-technocore-relay-unit', 'security-unit', 'local-http-boundary', 'release-artifact-drift'],
  manualReleaseRehearsal: ['local-full-lifecycle-smoke', 'production-dependency-audit'],
};
await writeFile(`${root}/release/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ releaseArtifacts: 'ok', components: components.length, migrations: migrations.length }));
