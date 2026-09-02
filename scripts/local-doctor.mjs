import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argumentsList = process.argv.slice(2);
const jsonOutput = argumentsList.includes('--json');
const staticOnly = argumentsList.includes('--static');
const noSpawn = argumentsList.includes('--no-spawn');
const originIndex = argumentsList.indexOf('--origin');
const requestedOrigin = originIndex >= 0 ? argumentsList[originIndex + 1] : 'http://localhost:3000';
const checks = [];

function record(id, ok, detail) {
  checks.push({ id, status: ok ? 'ready' : 'failed', detail });
  return ok;
}

function versionAtLeast(actual, minimum) {
  const left = actual.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  return left[0] > right[0] || (left[0] === right[0] && (left[1] > right[1] || (left[1] === right[1] && left[2] >= right[2])));
}

function npmInvocation(args) {
  const npmScript = process.env.npm_execpath;
  return npmScript
    ? { command: process.execPath, args: [npmScript, ...args] }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

function runNpm(args) {
  const invocation = npmInvocation(args);
  return spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FOUNDRY_TECHNOCORE_RELAY_ENABLED: '0', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function activeDevServerMatches(origin) {
  try {
    const lock = JSON.parse(await readFile(join(root, '.vinext', 'dev', 'lock.json'), 'utf8'));
    if (lock.cwd !== root || new URL(lock.appUrl).origin !== origin.origin || !Number.isSafeInteger(lock.pid) || lock.pid < 1) return false;
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!port) throw new Error('Could not reserve a loopback port for the local readiness check.');
  return port;
}

async function readHealth(origin, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(new URL('/api/health', origin), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.schema === 'foundry-local-health-v1' && body.status === 'ready' && body.database === 'ready' && body.files === 'ready') {
          const missionsResponse = await fetch(new URL('/api/missions', origin), {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(2_000),
          });
          if (missionsResponse.ok) {
            const missionsBody = await missionsResponse.json();
            const seedIds = new Set(Array.isArray(missionsBody?.missions) ? missionsBody.missions.map((mission) => mission?.id) : []);
            if (['M-042', 'M-039', 'M-031'].every((id) => seedIds.has(id))) return true;
          }
        }
      }
    } catch {
      // A local server may still be compiling. The bounded retry loop handles it.
    }
    if (attempt + 1 < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return false;
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function checkRuntime() {
  let origin;
  try {
    origin = new URL(requestedOrigin);
    if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('not loopback');
    }
  } catch {
    record('runtime-origin', false, '--origin must be a bare localhost or 127.0.0.1 HTTP origin.');
    return;
  }
  if (await readHealth(origin, 2)) {
    record('runtime', true, `D1 schema, seed missions, and R2 binding are ready at ${origin.origin}.`);
    return;
  }
  if (await activeDevServerMatches(origin)) {
    const ready = await readHealth(origin, 60);
    record('runtime', ready, ready
      ? `D1 schema, seed missions, and R2 binding are ready at ${origin.origin}.`
      : `The active Foundry server at ${origin.origin} did not become ready within 30 seconds.`);
    return;
  }
  if (noSpawn) {
    record('runtime', false, `No ready Foundry server answered at ${origin.origin}.`);
    return;
  }
  const port = await freeLoopbackPort();
  const temporaryOrigin = `http://127.0.0.1:${port}`;
  const executable = join(root, 'node_modules', 'vinext', 'dist', 'cli.js');
  let output = '';
  const child = spawn(process.execPath, [executable, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FOUNDRY_TECHNOCORE_RELAY_ENABLED: '0', FOUNDRY_PUBLIC_ORIGIN: '', WRANGLER_SEND_METRICS: 'false' },
  });
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  try {
    const ready = await readHealth(temporaryOrigin, 120);
    record('runtime', ready, ready
      ? `D1 schema, seed missions, and R2 binding passed a temporary loopback readiness check.`
      : `Temporary Foundry server did not become ready.${output ? ' Inspect npm run dev output.' : ''}`);
  } finally {
    await stopChild(child);
  }
}

record('node', versionAtLeast(process.versions.node, '22.13.0'), `Node ${process.versions.node}; required >=22.13.0.`);
try {
  const [packageJson, lockfile, hosting] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
    readFile(join(root, '.openai', 'hosting.json'), 'utf8').then(JSON.parse),
  ]);
  record('project', packageJson.name === 'technocore-foundry' && lockfile.name === packageJson.name, 'Package metadata and lockfile identify the same project.');
  record('bindings', hosting.d1 === 'DB' && hosting.r2 === 'FILES', 'Local D1=DB and R2=FILES bindings are declared.');
} catch {
  record('project', false, 'Package, lockfile, or hosting metadata could not be read.');
}
try {
  await access(root, constants.R_OK | constants.W_OK);
  record('workspace', true, 'Project directory is readable and writable for local state.');
} catch {
  record('workspace', false, 'Project directory is not readable and writable.');
}
const dependencies = runNpm(['ls', '--depth=0', '--json']);
record('dependencies', dependencies.status === 0, dependencies.status === 0 ? 'Locked npm dependencies are installed.' : 'Run npm run setup to install the locked dependencies.');
const commons = spawnSync(process.execPath, [join(root, 'scripts', 'commons-registry.mjs'), '--check'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FOUNDRY_TECHNOCORE_RELAY_ENABLED: '0', WRANGLER_SEND_METRICS: 'false' },
  maxBuffer: 2 * 1024 * 1024,
});
record('commons', commons.status === 0, commons.status === 0 ? 'Proof Commons source and derived index are in sync.' : 'Proof Commons validation or generated-index drift check failed.');

if (!staticOnly) await checkRuntime();

const ok = checks.every((check) => check.status === 'ready');
const report = {
  schema: 'foundry-local-doctor-v1',
  status: ok ? 'ready' : 'failed',
  network: 'No DID was created and no Technocore, GitHub, observer, or relay request was made.',
  checks,
};
if (jsonOutput) process.stdout.write(`${JSON.stringify(report)}\n`);
else {
  process.stdout.write(`Technocore Foundry doctor: ${report.status.toUpperCase()}\n`);
  for (const check of checks) process.stdout.write(`${check.status === 'ready' ? '✓' : '×'} ${check.id}: ${check.detail}\n`);
  process.stdout.write(`${report.network}\n`);
}
if (!ok) process.exitCode = 1;
