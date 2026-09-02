import process from 'node:process';

const context = 'Trusted Proof Commons admission';
const state = process.env.COMMONS_STATUS_STATE;
const sha = process.env.COMMONS_STATUS_SHA;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!['pending', 'success', 'failure'].includes(state)) throw new Error('COMMONS_STATUS_STATE is invalid.');
if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('COMMONS_STATUS_SHA must be a full Git commit hash.');
if (!repository || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) throw new Error('GITHUB_REPOSITORY is invalid.');
if (!token) throw new Error('GITHUB_TOKEN is unavailable.');

const [owner, name] = repository.split('/').map(encodeURIComponent);
const runUrl = process.env.GITHUB_RUN_ID && process.env.GITHUB_SERVER_URL
  ? `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const response = await fetch(`https://api.github.com/repos/${owner}/${name}/statuses/${sha}`, {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Technocore-Foundry-Admission/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: JSON.stringify({
    state,
    context,
    description: state === 'pending'
      ? 'Trusted-base offline admission is running.'
      : state === 'success'
        ? 'Trusted-base offline admission passed.'
        : 'Trusted-base offline admission failed.',
    ...(runUrl ? { target_url: runUrl } : {}),
  }),
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) throw new Error(`GitHub status API returned ${response.status}.`);
process.stdout.write(`${JSON.stringify({ context, state, sha })}\n`);
