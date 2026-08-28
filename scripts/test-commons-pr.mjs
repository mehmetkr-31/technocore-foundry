import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createAcceptedDossierFixture } from './fixtures/accepted-dossier.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(projectRoot, 'scripts/check-commons-pr.mjs');
const fixture = createAcceptedDossierFixture();
const root = await mkdtemp(join(tmpdir(), 'foundry-commons-pr-'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const check = (base, head) => execFileSync(process.execPath, [checker], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, COMMONS_BASE_SHA: base, COMMONS_HEAD_SHA: head, COMMONS_REPOSITORY_ROOT: root },
}).trim();

try {
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Commons Test');
  git('config', 'user.email', 'commons-test@example.invalid');
  await mkdir(join(root, 'commons/dossiers'), { recursive: true });
  await writeFile(join(root, 'commons/dossiers/.gitkeep'), '');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');

  const dossierPath = `commons/dossiers/${fixture.verified.id}.json`;
  await writeFile(join(root, dossierPath), fixture.bytes, { mode: 0o644 });
  git('add', dossierPath);
  git('commit', '-m', 'add dossier');
  const validHead = git('rev-parse', 'HEAD');
  assert.match(check(base, validHead), /commonsPullRequest/);

  await writeFile(join(root, 'README.md'), 'scope expansion\n');
  git('add', 'README.md');
  git('commit', '-m', 'expand scope');
  const expandedHead = git('rev-parse', 'HEAD');
  assert.throws(() => check(base, expandedHead), /Command failed/);

  await writeFile(join(root, dossierPath), Buffer.concat([fixture.bytes, Buffer.from('\n')]));
  git('add', dossierPath);
  git('commit', '-m', 'modify immutable dossier');
  const modifiedHead = git('rev-parse', 'HEAD');
  assert.throws(() => check(validHead, modifiedHead), /Command failed/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ commonsPullRequest: 'ok', gates: ['one-addition', 'scope-expansion', 'append-only'] }));
