import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, parseStrictJson } from './core.mjs';
import { verifyContributionDossierBytes } from './dossier.mjs';

export const COMMONS_INDEX_SCHEMA = 'foundry-proof-commons-index-v1';
export const COMMONS_POLICY_VERSION = '2026-08-28.v1';
export const COMMONS_REGISTRY_PATH = 'commons/dossiers';
export const MAX_COMMONS_DOSSIER_BYTES = 512 * 1024;
export const MAX_COMMONS_RECEIPTS = 64;
export const MAX_COMMONS_DIDS = 32;
export const MAX_COMMONS_JSON_DEPTH = 64;
export const MAX_COMMONS_JSON_NODES = 50_000;

const DOSSIER_FILE = /^(fds_[a-f0-9]{24})\.json$/;
const RECEIPT_CAPS = { verification: 16, review: 16, attestation: 32 };

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function boundedText(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}

function parsePublicHttps(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute public HTTPS URL.`); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
    !hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname) ||
    !hostname.split('.').every((labelPart) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labelPart))) {
    throw new Error(`${label} must use public HTTPS without credentials, ports, query strings, fragments, or literal/private hosts.`);
  }
  return url;
}

function githubRepository(value, label) {
  const url = parsePublicHttps(value, label);
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error(`${label} must use github.com.`);
  const match = /^\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(url.pathname);
  if (!match || match[2].endsWith('.git')) throw new Error(`${label} must be a plain GitHub owner/repository URL.`);
  return { owner: match[1].toLowerCase(), repository: match[2].toLowerCase() };
}

function assertRelatedGitHubUrl(value, repository, kind) {
  const url = parsePublicHttps(value, `GitHub ${kind} URL`);
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error(`GitHub ${kind} URL must use github.com.`);
  const suffix = kind === 'pull request' ? 'pull' : 'actions/runs';
  const expected = `/${repository.owner}/${repository.repository}/${suffix}/`;
  if (!url.pathname.toLowerCase().startsWith(expected) || !/^\d+$/.test(url.pathname.slice(expected.length))) {
    throw new Error(`GitHub ${kind} URL must point to the claimed repository.`);
  }
}

function assertArtifactUri(value, sha256) {
  if (value === `urn:sha256:${sha256}`) return;
  let url;
  try { url = new URL(value); } catch { throw new Error('Artifact URI is malformed.'); }
  const localArtifact = url.protocol === 'http:' && url.hostname === 'localhost' && !url.username && !url.password &&
    !url.search && !url.hash && /^\/api\/artifacts\/res_[a-f0-9]{24}$/.test(url.pathname);
  if (localArtifact) return;
  parsePublicHttps(value, 'Artifact URI');
}

function assertGitHubObservation(observation) {
  if (observation === null) return;
  if (!exactKeys(observation, ['signed', 'githubStatus', 'ciStatus', 'identityBinding', 'detail', 'checkedAt', 'snapshotCanonicalSha256']) ||
    observation.signed !== false || !['verified', 'unverified', 'error'].includes(observation.githubStatus) ||
    !['verified', 'unverified', 'not_checked', 'error'].includes(observation.ciStatus) ||
    observation.identityBinding !== 'not_established' || !boundedText(observation.detail, 1, 500) ||
    typeof observation.checkedAt !== 'string' || !Number.isFinite(Date.parse(observation.checkedAt)) ||
    !/^sha256:[a-f0-9]{64}$/.test(observation.snapshotCanonicalSha256)) {
    throw new Error('Commons dossier contains a malformed unsigned GitHub observation.');
  }
}

function assertPublicDossierMetadata(dossier) {
  for (const revision of dossier.revisionChain) {
    const repository = revision.github.claim.repository === null
      ? null
      : githubRepository(revision.github.claim.repository, 'GitHub repository claim');
    assertGitHubObservation(revision.github.observation);
    if (revision.github.claim.commit !== null && repository === null) throw new Error('GitHub commit claim requires a repository claim.');
  }
  for (const receipt of dossier.receipts) {
    if (!['result', 'finalization'].includes(receipt.kind)) continue;
    for (const artifact of receipt.payload.artifacts) assertArtifactUri(artifact.uri, artifact.sha256);
    const evidence = receipt.payload.evidence;
    if (!evidence) continue;
    const repository = evidence.repository ? githubRepository(evidence.repository, 'TCR-1 GitHub repository') : null;
    if ((evidence.commit || evidence.pull_request || evidence.ci_url) && !repository) {
      throw new Error('TCR-1 GitHub evidence requires a repository URL.');
    }
    if (evidence.pull_request) assertRelatedGitHubUrl(evidence.pull_request, repository, 'pull request');
    if (evidence.ci_url) assertRelatedGitHubUrl(evidence.ci_url, repository, 'Actions run');
  }
}

function assertJsonResourceProfile(bytes) {
  if (bytes.length < 2 || bytes.length > MAX_COMMONS_DOSSIER_BYTES) {
    throw new Error(`Commons dossier must be between 2 and ${MAX_COMMONS_DOSSIER_BYTES} bytes.`);
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let depth = 0;
  let nodes = 1;
  let inString = false;
  let escaped = false;
  for (const character of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      nodes += 1;
      if (depth > MAX_COMMONS_JSON_DEPTH) throw new Error('Commons dossier exceeds the JSON depth limit.');
    } else if (character === '}' || character === ']') {
      depth -= 1;
    } else if (character === ',') {
      nodes += 1;
    }
    if (nodes > MAX_COMMONS_JSON_NODES) throw new Error('Commons dossier exceeds the JSON node limit.');
  }
}

function receiptCounts(dossier) {
  return dossier.receipts.reduce((counts, receipt) => {
    counts[receipt.kind] = (counts[receipt.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function distinctDids(dossier) {
  return new Set([
    dossier.subject.claimantDid,
    dossier.mission.issuerDid,
    ...dossier.receipts.map((receipt) => receipt.actorDid),
  ]);
}

function proofGaps(layers) {
  const gaps = [];
  if (layers.executionEvidence === 'absent') gaps.push('execution_evidence');
  if (layers.structuredReview === 'absent') gaps.push('structured_review');
  if (layers.peerEvidence === 'absent') gaps.push('peer_evidence');
  if (layers.artifact !== 'valid') gaps.push('artifact_bytes');
  return gaps;
}

export function verifyCommonsDossierBytes(input, options = {}) {
  const bytes = Buffer.from(input);
  assertJsonResourceProfile(bytes);
  if (bytes.subarray(0, 80).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')) {
    throw new Error('Git LFS pointer files are not valid Commons dossiers.');
  }
  const verification = verifyContributionDossierBytes(bytes, { expectedId: options.expectedId });
  const dossier = parseStrictJson(bytes.toString('utf8'));
  assertPublicDossierMetadata(dossier);
  if (!['accepted', 'finalized'].includes(verification.selectedState)) {
    throw new Error('Commons admission requires a signed latest issuer acceptance.');
  }
  if (!dossier.mission.receiptId) {
    throw new Error('Commons admission requires a signed mission receipt.');
  }
  if (dossier.receipts.length > MAX_COMMONS_RECEIPTS) {
    throw new Error(`Commons dossier exceeds the ${MAX_COMMONS_RECEIPTS}-receipt profile.`);
  }
  const counts = receiptCounts(dossier);
  for (const [kind, cap] of Object.entries(RECEIPT_CAPS)) {
    if ((counts[kind] ?? 0) > cap) throw new Error(`Commons dossier exceeds the ${kind} receipt cap.`);
  }
  const dids = distinctDids(dossier);
  if (dids.size > MAX_COMMONS_DIDS) throw new Error(`Commons dossier exceeds the ${MAX_COMMONS_DIDS}-DID profile.`);

  const selected = dossier.revisionChain.at(-1);
  const gaps = proofGaps(verification.layers);
  return {
    dossier,
    verification,
    entry: {
      id: verification.id,
      dossierSha256: verification.sha256,
      missionId: dossier.mission.id,
      missionTitle: dossier.mission.title,
      missionLane: dossier.mission.lane,
      missionSummary: dossier.mission.summary,
      claimantDid: dossier.subject.claimantDid,
      issuerDid: dossier.mission.issuerDid,
      roleSeparation: dossier.subject.claimantDid === dossier.mission.issuerDid ? 'same_key' : 'distinct_keys',
      selectedResultId: dossier.subject.selectedResultId,
      selectedState: verification.selectedState,
      revisionCount: dossier.revisionChain.length,
      receiptCount: dossier.receipts.length,
      receiptCounts: {
        execution: selected.executionEvidenceReceiptIds.length,
        structuredReview: selected.reviewReceiptIds.length,
        peerEvidence: selected.attestationReceiptIds.length,
      },
      artifact: {
        mediaType: selected.artifact.mediaType,
        bytes: selected.artifact.bytes,
        sha256: selected.artifact.sha256,
      },
      layers: verification.layers,
      proofGaps: gaps,
      sourcePath: `${COMMONS_REGISTRY_PATH}/${verification.id}.json`,
    },
  };
}

export async function loadCommonsRegistry(registryDirectory) {
  const directoryEntries = await readdir(registryDirectory, { withFileTypes: true });
  const files = directoryEntries.map((entry) => entry.name).sort();
  const output = [];
  for (const name of files) {
    const path = join(registryDirectory, name);
    if (name === '.gitkeep') {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.size !== 0) throw new Error('Commons .gitkeep must be an empty regular file.');
      continue;
    }
    const match = DOSSIER_FILE.exec(name);
    if (!match) throw new Error(`Unexpected Commons registry entry: ${name}.`);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Commons registry entry must be a regular file: ${name}.`);
    if ((metadata.mode & 0o111) !== 0) throw new Error(`Commons registry entry must not be executable: ${name}.`);
    if (metadata.size > MAX_COMMONS_DOSSIER_BYTES) throw new Error(`Commons registry entry is too large: ${name}.`);
    const bytes = await readFile(path);
    output.push(verifyCommonsDossierBytes(bytes, { expectedId: match[1] }));
  }
  return output;
}

export function buildCommonsIndex(records) {
  const entries = records.map((record) => record.entry).sort((left, right) => left.id.localeCompare(right.id));
  const participants = new Set(entries.flatMap((entry) => [entry.claimantDid, entry.issuerDid]));
  return {
    schema: COMMONS_INDEX_SCHEMA,
    policyVersion: COMMONS_POLICY_VERSION,
    registryPath: COMMONS_REGISTRY_PATH,
    metrics: {
      dossiers: entries.length,
      participants: participants.size,
      receipts: entries.reduce((sum, entry) => sum + entry.receiptCount, 0),
      proofGaps: entries.reduce((sum, entry) => sum + entry.proofGaps.length, 0),
    },
    entries,
  };
}

export function serializeCommonsIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function canonicalCommonsIndex(index) {
  return canonicalJson(index);
}
