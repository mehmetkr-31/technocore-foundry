import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

if (args.includes('--help')) {
  process.stdout.write('npm run setup\n\nInstalls locked dependencies and runs local-only readiness checks.\nNetwork use: npm registry during npm ci only. No DID creation or Technocore publication.\n');
  process.exit(0);
}

function versionAtLeast(actual, minimum) {
  const left = actual.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  return left[0] > right[0] || (left[0] === right[0] && (left[1] > right[1] || (left[1] === right[1] && left[2] >= right[2])));
}

function run(command, commandArgs, label) {
  process.stdout.write(`\n${label}\n`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, FOUNDRY_TECHNOCORE_RELAY_ENABLED: '0', FOUNDRY_PUBLIC_ORIGIN: '', WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!versionAtLeast(process.versions.node, '22.13.0')) {
  throw new Error(`Node ${process.versions.node} is unsupported. Install Node 22.13.0 or newer.`);
}
if (!args.includes('--skip-install')) {
  const npmScript = process.env.npm_execpath;
  if (npmScript) run(process.execPath, [npmScript, 'ci', '--no-fund', '--no-audit'], 'Installing exact lockfile dependencies…');
  else run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-fund', '--no-audit'], 'Installing exact lockfile dependencies…');
}
run(process.execPath, [join(root, 'scripts', 'commons-registry.mjs'), '--check'], 'Checking the offline Proof Commons registry…');
run(process.execPath, [join(root, 'scripts', 'local-doctor.mjs'), ...(args.includes('--static') ? ['--static'] : [])], 'Running local readiness checks…');
process.stdout.write('\nSetup complete. Start Foundry with: npm run dev\nOpen exactly: http://localhost:3000\n');
