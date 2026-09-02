import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const script of ['setup', 'doctor', 'signer', 'verifier', 'test:onboarding']) {
  assert.equal(typeof packageJson.scripts[script], 'string', `Missing npm script: ${script}`);
}
const doctor = spawnSync(process.execPath, [join(root, 'scripts', 'local-doctor.mjs'), '--json', '--static'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FOUNDRY_TECHNOCORE_RELAY_ENABLED: '0', FOUNDRY_PUBLIC_ORIGIN: '' },
});
assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
const report = JSON.parse(doctor.stdout);
assert.equal(report.schema, 'foundry-local-doctor-v1');
assert.equal(report.status, 'ready');
assert.match(report.network, /No DID was created/);
assert.equal(report.checks.some((check) => check.id === 'bindings' && check.status === 'ready'), true);
const help = spawnSync(process.execPath, [join(root, 'scripts', 'setup-local.mjs'), '--help'], { cwd: root, encoding: 'utf8' });
assert.equal(help.status, 0);
assert.match(help.stdout, /No DID creation or Technocore publication/);
const setup = spawnSync(process.execPath, [join(root, 'scripts', 'setup-local.mjs'), '--skip-install', '--static'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FOUNDRY_TECHNOCORE_RELAY_ENABLED: '0', FOUNDRY_PUBLIC_ORIGIN: '', WRANGLER_SEND_METRICS: 'false' },
});
assert.equal(setup.status, 0, setup.stderr || setup.stdout);
assert.match(setup.stdout, /Setup complete/);

console.log(JSON.stringify({ onboarding: 'ok', gates: ['node-version', 'locked-dependencies', 'bindings', 'commons-drift', 'setup-orchestration', 'network-boundary'] }));
