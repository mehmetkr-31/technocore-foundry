import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createAcceptedDossierFixture } from './fixtures/accepted-dossier.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(projectRoot, 'scripts/check-commons-pr.mjs');
const registry = join(projectRoot, 'scripts/commons-registry.mjs');
const mergeResolver = join(projectRoot, 'scripts/resolve-commons-merge.mjs');
const fixture = createAcceptedDossierFixture();
const root = await mkdtemp(join(tmpdir(), 'foundry-commons-pr-'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const check = (base, head) => execFileSync(process.execPath, [checker], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, COMMONS_BASE_SHA: base, COMMONS_HEAD_SHA: head, COMMONS_REPOSITORY_ROOT: root },
}).trim();
const buildIndex = () => execFileSync(process.execPath, [registry, '--write'], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, COMMONS_REPOSITORY_ROOT: root },
});
const checkIndex = () => execFileSync(process.execPath, [registry, '--check'], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, COMMONS_REPOSITORY_ROOT: root },
});
const resolveMerge = (base, head, pullRequest) => execFileSync(process.execPath, [mergeResolver], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    COMMONS_BASE_SHA: base,
    COMMONS_HEAD_SHA: head,
    COMMONS_PULL_REQUEST: String(pullRequest),
    COMMONS_TRUSTED_ROOT: root,
  },
}).trim();

try {
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Commons Test');
  git('config', 'user.email', 'commons-test@example.invalid');
  await mkdir(join(root, 'commons/dossiers'), { recursive: true });
  await writeFile(join(root, 'commons/dossiers/.gitkeep'), '');
  buildIndex();
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');

  await writeFile(join(root, 'README.md'), 'ordinary project change\n');
  git('add', 'README.md');
  git('commit', '-m', 'ordinary change');
  const ordinaryHead = git('rev-parse', 'HEAD');
  assert.match(check(base, ordinaryHead), /not_applicable/);
  const ordinaryTree = git('rev-parse', `${ordinaryHead}^{tree}`);
  const mergeSha = execFileSync('git', ['commit-tree', ordinaryTree, '-p', base, '-p', ordinaryHead], {
    cwd: root,
    encoding: 'utf8',
    input: 'synthetic GitHub test merge\n',
  }).trim();
  git('update-ref', 'refs/pull/7/merge', mergeSha);
  git('remote', 'add', 'origin', root);
  assert.equal(resolveMerge(base, ordinaryHead, 7), `merge_sha=${mergeSha}`);
  git('update-ref', 'refs/pull/8/merge', ordinaryHead);
  assert.throws(() => resolveMerge(base, ordinaryHead, 8), /Command failed/);
  git('switch', '--detach', base);

  const dossierPath = `commons/dossiers/${fixture.verified.id}.json`;
  await writeFile(join(root, dossierPath), fixture.bytes, { mode: 0o644 });
  buildIndex();
  assert.doesNotThrow(checkIndex);
  await writeFile(join(root, 'public/commons/index.json'), '{}\n');
  assert.throws(checkIndex, /Command failed/);
  buildIndex();
  git('add', dossierPath, 'public/commons/index.json');
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

console.log(JSON.stringify({ commonsPullRequest: 'ok', gates: ['always-present', 'not-applicable', 'bound-test-merge', 'one-addition', 'deterministic-index', 'scope-expansion', 'append-only'] }));
