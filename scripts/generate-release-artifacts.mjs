import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, writeFile, mkdir } from 'node:fs/promises';
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
const indexedEntries = splitNul(execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root }))
  .map((entry) => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[3] !== '0') throw new Error('Release input index contains an unsupported or conflicted entry.');
    if (!['100644', '100755'].includes(match[1])) {
      throw new Error(`Release input ${match[4]} must be a regular file, not mode ${match[1]}.`);
    }
    return { mode: match[1], objectId: match[2], path: match[4] };
  });
const indexedEntriesByPath = new Map(indexedEntries.map((entry) => [entry.path, entry]));
if (indexedEntriesByPath.size !== indexedEntries.length) throw new Error('Release input index contains duplicate paths.');
const indexedBytes = (path) => {
  const entry = indexedEntriesByPath.get(path);
  if (!entry) throw new Error(`Required release input ${path} is absent from the index.`);
  return readIndexedBlob(entry.objectId, path);
};
const releaseInputSet = indexedEntries
  .filter(({ path }) => !generatedReleasePaths.has(path))
  .sort((left, right) => compareCodeUnits(left.path, right.path))
  .map(({ mode, objectId, path }) => ({
    path,
    mode,
    sha256: digest(readIndexedBlob(objectId, path)),
  }));
const releaseInputSetSha256 = digest(Buffer.from(JSON.stringify(releaseInputSet), 'utf8'));
const lockBytes = indexedBytes('package-lock.json');
const lock = JSON.parse(lockBytes.toString('utf8'));
const packageJson = JSON.parse(indexedBytes('package.json').toString('utf8'));
const technocoreLockBytes = indexedBytes('protocol/upstream/technocore-chat.lock.json');
const technocoreLockSource = technocoreLockBytes.toString('utf8');
const technocoreLock = JSON.parse(technocoreLockSource);
if (technocoreLockSource !== `${JSON.stringify(technocoreLock, null, 2)}\n`) {
  throw new Error('Technocore upstream lock must be canonical JSON.');
}
if (
  technocoreLock?.schema !== 'foundry-upstream-lock-v1' ||
  !['official-github-release', 'official-reviewed-tag'].includes(technocoreLock?.authority) ||
  technocoreLock?.repository !== 'flop-labs/technocore-chat' ||
  technocoreLock?.origin !== 'https://technocore.chat' ||
  !/^v\d+\.\d+\.\d+$/.test(technocoreLock?.release?.tag ?? '') ||
  technocoreLock.release.tag.slice(1) !== technocoreLock.release.version ||
  !/^[a-f0-9]{40}$/.test(technocoreLock.release.commit ?? '') ||
  !/^[a-f0-9]{40}$/.test(technocoreLock.observedMainCommit ?? '') ||
  technocoreLock?.liveBaseline?.serviceVersion !== technocoreLock.release.version ||
  !/^[a-f0-9]{64}$/.test(technocoreLock?.liveBaseline?.configSha256 ?? '') ||
  !/^[a-f0-9]{64}$/.test(technocoreLock?.liveBaseline?.openapiSha256 ?? '') ||
  !/^[a-f0-9]{64}$/.test(technocoreLock?.liveBaseline?.agentSha256 ?? '')
) {
  throw new Error('Technocore upstream lock is malformed or outside the release allow-list.');
}
const tclkLockBytes = indexedBytes('protocol/upstream/tclk.lock.json');
const tclkLockSource = tclkLockBytes.toString('utf8');
const tclkLock = JSON.parse(tclkLockSource);
if (tclkLockSource !== `${JSON.stringify(tclkLock, null, 2)}\n`) {
  throw new Error('TCLK upstream lock must be canonical JSON.');
}
if (
  tclkLock?.schema !== 'foundry-tclk-upstream-lock-v1' ||
  tclkLock?.authority !== 'official-reviewed-commit' ||
  tclkLock?.repository !== 'flop-labs/tclk' ||
  !/^v\d+\.\d+\.\d+$/.test(tclkLock?.release?.tag ?? '') ||
  tclkLock.release.tag.slice(1) !== tclkLock.release.version ||
  !/^[a-f0-9]{40}$/.test(tclkLock.release.commit ?? '') ||
  !/^[a-f0-9]{40}$/.test(tclkLock.operationalCommit ?? '') ||
  tclkLock.operationalCommit !== tclkLock.observedMainCommit ||
  tclkLock?.contract?.version !== 'tclk/1'
) {
  throw new Error('TCLK upstream lock is malformed or outside the reviewed allow-list.');
}
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

const releaseDirectory = `${root}/release`;
try {
  const releaseDirectoryStat = await lstat(releaseDirectory);
  if (!releaseDirectoryStat.isDirectory()) throw new Error('Release output directory must be a real directory.');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await mkdir(releaseDirectory);
}
const assertSafeOutput = async (path) => {
  try {
    const outputStat = await lstat(path);
    if (!outputStat.isFile() || outputStat.nlink !== 1) throw new Error(`Release output ${path.slice(root.length + 1)} must be a single-link regular file.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};
const sbomPath = `${releaseDirectory}/sbom.cdx.json`;
const licenseReportPath = `${releaseDirectory}/licenses.json`;
const manifestPath = `${releaseDirectory}/manifest.json`;
await Promise.all([sbomPath, licenseReportPath, manifestPath].map(assertSafeOutput));
const sbomBytes = Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
await writeFile(sbomPath, sbomBytes);
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
const licenseReportBytes = Buffer.from(`${JSON.stringify(dependencyLicenses, null, 2)}\n`, 'utf8');
await writeFile(licenseReportPath, licenseReportBytes);
const fixtureBytes = indexedBytes('protocol/fixtures/v1.json');
const licenseBytes = indexedBytes('LICENSE');
const noticeBytes = indexedBytes('NOTICE');
const localOperationsBytes = indexedBytes('docs/LOCAL_OPERATIONS.md');
const roadmapBytes = indexedBytes('ROADMAP.md');
const relayPolicyBytes = indexedBytes('lib/technocore-relay-policy.ts');
const relayServiceBytes = indexedBytes('lib/technocore-relay-service.ts');
const relayStoreBytes = indexedBytes('db/technocore-relay-attempts.ts');
const relayRouteBytes = indexedBytes('app/api/technocore/publish/route.ts');
const browserVerifierBytes = indexedBytes('lib/browser-dossier-verifier.mjs');
const commonsRegistryBytes = indexedBytes('scripts/commons-registry.mjs');
const commonsIndexBytes = indexedBytes('public/commons/index.json');
const migrationPaths = indexedEntries.map(({ path }) => path).filter((path) => /^drizzle\/\d{4}_.+\.sql$/.test(path)).sort(compareCodeUnits);
const migrationDigests = Object.fromEntries(migrationPaths.map((path) => [path.slice('drizzle/'.length), digest(indexedBytes(path))]));
const drizzleMetadataPaths = indexedEntries.map(({ path }) => path).filter((path) => /^drizzle\/meta\/(?:_journal|\d{4}_snapshot)\.json$/.test(path)).sort(compareCodeUnits);
const drizzleMetadataDigests = Object.fromEntries(drizzleMetadataPaths.map((path) => [path.slice('drizzle/meta/'.length), digest(indexedBytes(path))]));
const manifest = {
  schema: 'technocore-foundry-release-manifest-v2',
  version: releaseVersion,
  sourceRepository: packageJson.repository.url,
  releaseInputSetSha256,
  releaseInputCount: releaseInputSet.length,
  access: 'owner-only',
  publicWrite: 'disabled-until-explicit-operator-action',
  technocore: {
    origin: technocoreLock.origin,
    room: 'foundry-contributions',
    releaseTag: technocoreLock.release.tag,
    adapterVersion: technocoreLock.release.version,
    sourceCommit: technocoreLock.release.commit,
    relayAcknowledgementSourceCommit: technocoreLock.release.commit,
    observedMainCommit: technocoreLock.observedMainCommit,
    liveConfigSha256: technocoreLock.liveBaseline.configSha256,
    liveOpenapiSha256: technocoreLock.liveBaseline.openapiSha256,
    liveAgentSha256: technocoreLock.liveBaseline.agentSha256,
    observationTrust: 'signature_verified_when_present',
  },
  tclk: {
    releaseTag: tclkLock.release.tag,
    releaseCommit: tclkLock.release.commit,
    operationalCommit: tclkLock.operationalCommit,
    protocolVersion: tclkLock.contract.version,
    settlement: 'inspection-only-no-value-bearing-rail',
  },
  artifacts: {
    protocolFixtureSha256: digest(fixtureBytes),
    packageLockSha256: digest(lockBytes),
    technocoreUpstreamLockSha256: digest(technocoreLockBytes),
    tclkUpstreamLockSha256: digest(tclkLockBytes),
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
  expectedVerificationGates: ['lint', 'typescript', 'build', 'migration-generation-drift', 'blank-migration-apply', 'protocol-ts', 'protocol-python', 'signer', 'dossier-offline', 'commons-offline', 'browser-verifier-unit-parity', 'tclk-inspector', 'technocore-contract', 'participation-bundle', 'upstream-lock', 'tclk-upstream-lock', 'onboarding', 'local-doctor', 'observer', 'durable-technocore-relay-unit', 'security-unit', 'production-dependency-audit', 'local-http-boundary', 'release-artifact-drift'],
  manualReleaseRehearsal: ['local-full-lifecycle-smoke'],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ releaseArtifacts: 'ok', components: components.length, migrations: migrationPaths.length }));
