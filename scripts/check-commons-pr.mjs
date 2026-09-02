import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const base = process.env.COMMONS_BASE_SHA;
const head = process.env.COMMONS_HEAD_SHA;
const repositoryRoot = resolve(process.env.COMMONS_REPOSITORY_ROOT ?? process.cwd());
if (!base || !/^[a-f0-9]{40}$/.test(base) || !head || !/^[a-f0-9]{40}$/.test(head)) {
  throw new Error('COMMONS_BASE_SHA and COMMONS_HEAD_SHA must be full Git commit hashes.');
}

const output = execFileSync('git', ['diff', '--name-status', '--no-renames', `${base}...${head}`], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const changes = output.trim() ? output.trim().split('\n').map((line) => line.split('\t')) : [];
const dossierChanges = changes.filter(([, path]) => path.startsWith('commons/dossiers/'));
const indexChanges = changes.filter(([, path]) => path === 'public/commons/index.json');
if (dossierChanges.length === 0 && indexChanges.length === 0) {
  console.log(JSON.stringify({ commonsPullRequest: 'not_applicable', changedPaths: changes.length }));
  process.exit(0);
}
const dossiers = changes.filter(([, path]) => /^commons\/dossiers\/fds_[a-f0-9]{24}\.json$/.test(path));
if (
  changes.length !== 2 || dossiers.length !== 1 || dossiers[0][0] !== 'A' ||
  indexChanges.length !== 1 || indexChanges[0][0] !== 'M'
) {
  throw new Error('A Commons admission PR must add one commons/dossiers/fds_<24hex>.json file and update only the deterministic public/commons/index.json.');
}

const staged = execFileSync('git', ['ls-tree', head, '--', dossiers[0][1]], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
if (!/^100644 blob [a-f0-9]{40}\t/.test(staged)) throw new Error('Commons dossier must be a regular, non-executable Git blob (mode 100644).');

console.log(JSON.stringify({ commonsPullRequest: 'ok', added: dossiers[0][1], derivedIndex: indexChanges[0][1] }));
