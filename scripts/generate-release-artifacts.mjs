import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(`${root}/package-lock.json`, 'utf8'));
const packageJson = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
const releaseVersion = packageJson.version;
const components = Object.entries(lock.packages ?? {})
  .filter(([path, entry]) => path.includes('node_modules/') && entry?.version)
  .map(([path, entry]) => {
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const encodedName = name.split('/').map(encodeURIComponent).join('/');
    return {
      type: 'library',
      'bom-ref': `pkg:npm/${encodedName}@${entry.version}`,
      name,
      version: entry.version,
      purl: `pkg:npm/${encodedName}@${entry.version}`,
      scope: entry.dev ? 'optional' : 'required',
    };
  })
  .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));

const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: 'urn:uuid:8df78e92-f843-5f51-91a0-77c0f0a0d006', version: 1,
  metadata: { component: { type: 'application', 'bom-ref': `pkg:npm/technocore-foundry@${releaseVersion}`, name: 'technocore-foundry', version: releaseVersion } },
  components,
};

await mkdir(`${root}/release`, { recursive: true });
await writeFile(`${root}/release/sbom.cdx.json`, `${JSON.stringify(sbom, null, 2)}\n`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtureBytes = await readFile(`${root}/protocol/fixtures/v1.json`);
const sbomBytes = await readFile(`${root}/release/sbom.cdx.json`);
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
    migrationSha256: migrationDigests,
  },
  gates: ['lint', 'typescript', 'build', 'protocol-ts', 'protocol-python', 'signer', 'dossier-offline', 'observer', 'security', 'smoke', 'production-npm-audit'],
};
await writeFile(`${root}/release/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ releaseArtifacts: 'ok', components: components.length, migrations: migrations.length }));
