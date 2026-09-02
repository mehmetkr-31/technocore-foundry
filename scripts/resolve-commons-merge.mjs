import { execFileSync } from 'node:child_process';
import process from 'node:process';

const base = process.env.COMMONS_BASE_SHA;
const head = process.env.COMMONS_HEAD_SHA;
const pullRequest = process.env.COMMONS_PULL_REQUEST;
const repositoryRoot = process.env.COMMONS_TRUSTED_ROOT ?? process.cwd();

if (!base || !/^[a-f0-9]{40}$/.test(base) || !head || !/^[a-f0-9]{40}$/.test(head)) {
  throw new Error('COMMONS_BASE_SHA and COMMONS_HEAD_SHA must be full Git commit hashes.');
}
if (!pullRequest || !/^[1-9]\d{0,9}$/.test(pullRequest)) {
  throw new Error('COMMONS_PULL_REQUEST must be a positive integer.');
}

const mergeRef = `refs/remotes/foundry-pull/${pullRequest}/merge`;
execFileSync('git', [
  'fetch', '--force', '--no-tags', 'origin',
  `+refs/pull/${pullRequest}/merge:${mergeRef}`,
], { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'inherit'] });

const mergeSha = execFileSync('git', ['rev-parse', '--verify', `${mergeRef}^{commit}`], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const parents = execFileSync('git', ['show', '--no-patch', '--format=%P', mergeSha], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim().split(/\s+/);

if (!/^[a-f0-9]{40}$/.test(mergeSha) || parents.length !== 2 || parents[0] !== base || parents[1] !== head) {
  throw new Error('GitHub test-merge commit does not bind the event base and head commits.');
}

process.stdout.write(`merge_sha=${mergeSha}\n`);
