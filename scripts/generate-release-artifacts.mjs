import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(`${root}/package-lock.json`, 'utf8'));
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
const components = Array.from(componentsByReference.values()).sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));

const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: 'urn:uuid:8df78e92-f843-5f51-91a0-77c0f0a0d006', version: 1,
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
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtureBytes = await readFile(`${root}/protocol/fixtures/v1.json`);
const sbomBytes = await readFile(`${root}/release/sbom.cdx.json`);
const licenseReportBytes = await readFile(`${root}/release/licenses.json`);
const licenseBytes = await readFile(`${root}/LICENSE`);
const noticeBytes = await readFile(`${root}/NOTICE`);
const migrations = (await readdir(`${root}/drizzle`)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const migrationDigests = Object.fromEntries(await Promise.all(migrations.map(async (name) => [name, digest(await readFile(`${root}/drizzle/${name}`))])));
const manifest = {
  schema: 'technocore-foundry-release-manifest-v1',
  version: releaseVersion,
  access: 'owner-only',
  publicWrite: 'disabled-until-explicit-operator-action',
  technocore: {
    origin: 'https://technocore.chat', room: 'foundry-contributions',
    sourceCommit: '9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c',
    observationTrust: 'transport_unverifiable',
  },
  artifacts: {
    protocolFixtureSha256: digest(fixtureBytes),
    sbomSha256: digest(sbomBytes),
    dependencyLicensesSha256: digest(licenseReportBytes),
    licenseSha256: digest(licenseBytes),
    noticeSha256: digest(noticeBytes),
    migrationSha256: migrationDigests,
  },
  gates: ['lint', 'typescript', 'build', 'protocol-ts', 'protocol-python', 'signer', 'dossier-offline', 'commons-offline', 'observer', 'security', 'smoke', 'production-npm-audit'],
};
await writeFile(`${root}/release/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ releaseArtifacts: 'ok', components: components.length, migrations: migrations.length }));
