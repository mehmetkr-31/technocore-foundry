import type { Tcr1Receipt } from './foundry-crypto';

export type EvidenceCheckSnapshot = {
  github: 'verified' | 'unverified' | 'error';
  ci: 'verified' | 'unverified' | 'not_checked' | 'error';
  identityBinding: 'not_established';
  detail: string;
  checkedAt: string;
};

type Repository = { owner: string; name: string };

function githubSegments(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub evidence contains an invalid URL.');
  }
  if (
    url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
    url.username || url.password || url.search || url.hash
  ) throw new Error('GitHub evidence must use a plain https://github.com URL.');
  return url.pathname.split('/').filter(Boolean);
}

function repositoryFromUrl(value: string): Repository {
  const segments = githubSegments(value);
  if (segments.length !== 2 || !segments.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error('Repository evidence must identify one GitHub owner and repository.');
  }
  return { owner: segments[0], name: segments[1] };
}

function relatedNumber(value: string, repository: Repository, path: string) {
  const segments = githubSegments(value);
  const prefix = [repository.owner, repository.name, ...path.split('/')];
  if (
    segments.length !== prefix.length + 1 ||
    segments.slice(0, -1).some((segment, index) => segment !== prefix[index]) ||
    !/^\d+$/.test(segments.at(-1) ?? '')
  ) throw new Error(`${path} evidence must belong to the same GitHub repository.`);
  return Number(segments.at(-1));
}

export function validateGitHubEvidence(evidence: Tcr1Receipt['evidence']) {
  if (!evidence) return null;
  if (!evidence.repository && (evidence.commit || evidence.pull_request || evidence.ci_url || evidence.ci_status)) {
    throw new Error('GitHub object evidence requires a repository URL.');
  }
  if (!evidence.repository) return null;
  const repository = repositoryFromUrl(evidence.repository);
  const commit = evidence.commit;
  if (commit && !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Commit evidence must be a lowercase 40-hex SHA.');
  const pullRequest = evidence.pull_request ? relatedNumber(evidence.pull_request, repository, 'pull') : null;
  const ciRun = evidence.ci_url ? relatedNumber(evidence.ci_url, repository, 'actions/runs') : null;
  if (evidence.ci_status && ciRun === null) throw new Error('CI status requires an Actions run URL.');
  if (ciRun !== null && !evidence.ci_status) throw new Error('An Actions run URL requires its claimed CI status.');
  return { repository, commit, pullRequest, ciRun };
}

async function fetchGitHub(path: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'technocore-foundry/0.3',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}.`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub returned an unexpected response.');
  return value as Record<string, unknown>;
}

export async function checkGitHubEvidence(receipt: Tcr1Receipt): Promise<EvidenceCheckSnapshot> {
  const checkedAt = new Date().toISOString();
  let parsed: ReturnType<typeof validateGitHubEvidence>;
  try {
    parsed = validateGitHubEvidence(receipt.evidence);
  } catch (error) {
    return {
      github: 'unverified',
      ci: 'not_checked',
      identityBinding: 'not_established',
      detail: error instanceof Error ? error.message : 'GitHub evidence is malformed.',
      checkedAt,
    };
  }
  if (!parsed) {
    return {
      github: 'unverified', ci: 'not_checked', identityBinding: 'not_established',
      detail: 'Repository evidence is missing.', checkedAt,
    };
  }
  if (!parsed.commit && parsed.pullRequest === null) {
    return {
      github: 'unverified', ci: 'not_checked', identityBinding: 'not_established',
      detail: 'A commit or pull request is required for a GitHub object check.', checkedAt,
    };
  }

  const { owner, name } = parsed.repository;
  try {
    let githubVerified = true;
    if (parsed.commit) {
      const commit = await fetchGitHub(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${parsed.commit}`);
      githubVerified = commit?.sha === parsed.commit;
    }
    if (parsed.pullRequest !== null) {
      const pull = await fetchGitHub(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${parsed.pullRequest}`);
      githubVerified = githubVerified && pull?.html_url === receipt.evidence?.pull_request;
      if (parsed.commit) {
        const head = pull?.head;
        githubVerified = githubVerified && Boolean(head && typeof head === 'object' && (head as Record<string, unknown>).sha === parsed.commit);
      }
    }

    let ci: EvidenceCheckSnapshot['ci'] = 'not_checked';
    if (parsed.ciRun !== null) {
      const run = await fetchGitHub(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs/${parsed.ciRun}`);
      const actual = run?.status === 'completed' ? run?.conclusion : run?.status;
      ci = run?.id === parsed.ciRun && actual === receipt.evidence?.ci_status ? 'verified' : 'unverified';
    }
    return {
      github: githubVerified ? 'verified' : 'unverified',
      ci,
      identityBinding: 'not_established',
      detail: 'GitHub object existence does not bind a GitHub author to the claimant DID.',
      checkedAt,
    };
  } catch (error) {
    return {
      github: 'error',
      ci: parsed.ciRun === null ? 'not_checked' : 'error',
      identityBinding: 'not_established',
      detail: error instanceof Error ? error.message : 'GitHub evidence check failed.',
      checkedAt,
    };
  }
}
