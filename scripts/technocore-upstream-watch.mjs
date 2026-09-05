import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectObservedTag } from './lib/technocore-watch-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'protocol', 'upstream', 'technocore-chat.lock.json');
const candidatePath = join(root, 'protocol', 'upstream', 'technocore-chat.candidate.json');
const reviewPath = join(root, 'docs', 'UPSTREAM_REVIEW.md');
const outputPath = process.env.GITHUB_OUTPUT;
const args = new Set(process.argv.slice(2));
const writeCandidate = args.has('--write-candidate');
const verifyCandidateMode = args.has('--verify-candidate');
const networkCheck = writeCandidate || args.has('--check');
const githubToken = process.env.GITHUB_TOKEN || '';
const watchedPaths = ['src/manual.md', 'src/app.py', 'src/store.py', 'src/didkey.py', 'README.md', 'CHANGELOG.md', 'src/config.py', 'src/manifest.py', 'src/limit.py'];

function fail(message) {
  throw new Error(`Technocore upstream watch: ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} fields drifted`);
}

function validateRelease(value, label) {
  exactKeys(value, ['tag', 'version', 'commit'], label);
  if (!/^v\d+\.\d+\.\d+$/.test(value.tag) || value.tag.slice(1) !== value.version || !/^[a-f0-9]{40}$/.test(value.commit)) {
    fail(`${label} pin is malformed`);
  }
}

function validateWatchedFiles(value, label) {
  if (!Array.isArray(value) || value.length !== watchedPaths.length) fail(`${label} allow-list is malformed`);
  for (const [index, item] of value.entries()) {
    exactKeys(item, ['path', 'gitBlob', 'sha256', 'bytes'], `${label} ${item?.path ?? '?'}`);
    if (item.path !== watchedPaths[index]) fail(`${label} path order or membership drifted`);
    if (!/^[a-f0-9]{40}$/.test(item.gitBlob) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 512 * 1024) {
      fail(`${label} metadata is malformed: ${item.path}`);
    }
  }
}

function validateLive(value, label) {
  exactKeys(value, ['serviceVersion', 'configSha256', 'openapiSha256', 'agentSha256'], label);
  if (value.serviceVersion !== null && (typeof value.serviceVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.serviceVersion))) {
    fail(`${label} service version is malformed`);
  }
  for (const key of ['configSha256', 'openapiSha256', 'agentSha256']) {
    if (!/^[a-f0-9]{64}$/.test(value[key])) fail(`${label} ${key} is malformed`);
  }
}

function validateLock(lock) {
  exactKeys(lock, ['schema', 'authority', 'repository', 'origin', 'release', 'observedMainCommit', 'watchedFiles', 'liveBaseline', 'contract'], 'lock');
  if (lock.schema !== 'foundry-upstream-lock-v1' || !['official-github-release', 'official-reviewed-tag'].includes(lock.authority)) fail('unsupported lock schema or authority');
  if (lock.repository !== 'flop-labs/technocore-chat' || lock.origin !== 'https://technocore.chat') fail('authority target is not allow-listed');
  validateRelease(lock.release, 'release');
  if (!/^[a-f0-9]{40}$/.test(lock.observedMainCommit)) fail('observed main commit is malformed');
  validateWatchedFiles(lock.watchedFiles, 'watched file');
  validateLive(lock.liveBaseline, 'live baseline');
  if (lock.liveBaseline.serviceVersion !== lock.release.version) fail('live baseline version and release pin disagree');
  exactKeys(lock.contract, [
    'roomNamePattern', 'noncePattern', 'signaturePattern', 'messageCharacters', 'noteCharacters',
    'idleSeconds', 'stillbornSeconds',
    'messageSigningTemplate', 'noteSigningTemplate', 'signedNoteNamespaces', 'roomReadFields',
    'signedRecordFields', 'exportGenerationHeader',
  ], 'reviewed contract');
  if (
    lock.contract.roomNamePattern !== '^[a-z0-9][a-z0-9_-]{0,47}$' ||
    lock.contract.noncePattern !== '^(?:0|[1-9]\\d{0,18})$' ||
    lock.contract.signaturePattern !== '^[A-Za-z0-9_-]{85}[AQgw]$' ||
    lock.contract.messageSigningTemplate !== '<room>|<nonce>|<text>' ||
    lock.contract.noteSigningTemplate !== '<namespace>|<key>|<nonce>|<value>'
  ) fail('reviewed lexical/signing contract drifted');
  if (
    lock.contract.messageCharacters !== 4096 || lock.contract.noteCharacters !== 8192 ||
    lock.contract.idleSeconds !== 604800 || !Number.isSafeInteger(lock.contract.stillbornSeconds) || lock.contract.stillbornSeconds < 3600 ||
    lock.contract.exportGenerationHeader !== 'X-Room-Generation' ||
    JSON.stringify(lock.contract.signedNoteNamespaces) !== JSON.stringify(['room-owners', 'room-allow']) ||
    JSON.stringify(lock.contract.roomReadFields) !== JSON.stringify(['room', 'count', 'first_seq', 'last_seq', 'generation', 'messages']) ||
    JSON.stringify(lock.contract.signedRecordFields) !== JSON.stringify(['seq', 'ts', 'from', 'text', 'nonce', 'sig'])
  ) fail('reviewed limit/export contract drifted');
  return lock;
}

async function readJson(path, maximum = 1024 * 1024) {
  const bytes = await readFile(path);
  if (bytes.byteLength < 2 || bytes.byteLength > maximum) fail(`${path.slice(root.length + 1)} exceeds its byte boundary`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`${path.slice(root.length + 1)} is not valid UTF-8`); }
  let value;
  try { value = JSON.parse(source); } catch { fail(`${path.slice(root.length + 1)} is not valid JSON`); }
  if (source !== `${JSON.stringify(value, null, 2)}\n`) fail(`${path.slice(root.length + 1)} is not canonical JSON`);
  return value;
}

async function optionalJson(path) {
  try { return await readJson(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function verifyRepositoryBindings(lock) {
  const [observer, relay, contract, releaseGenerator, packageJson, workflow] = await Promise.all([
    readFile(join(root, 'lib', 'technocore-observer.ts'), 'utf8'),
    readFile(join(root, 'lib', 'technocore-relay-service.ts'), 'utf8'),
    readFile(join(root, 'lib', 'technocore-contract.ts'), 'utf8'),
    readFile(join(root, 'scripts', 'generate-release-artifacts.mjs'), 'utf8'),
    readJson(join(root, 'package.json')),
    readFile(join(root, '.github', 'workflows', 'technocore-upstream-watch.yml'), 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error)),
  ]);
  if (!observer.includes('TECHNOCORE_OPERATIONAL_COMMIT') || !relay.includes('TECHNOCORE_OPERATIONAL_COMMIT') || !contract.includes('technocore-chat.lock.json')) fail('runtime source pins are not derived from the lock');
  if (!releaseGenerator.includes('protocol/upstream/technocore-chat.lock.json')) fail('release provenance is not derived from the lock');
  if (!packageJson.scripts?.['upstream:verify'] || !packageJson.scripts?.['upstream:check']) fail('package scripts do not expose lock verification and network watch');
  if (
    !workflow.includes('scripts/technocore-upstream-watch.mjs --write-candidate') ||
    !workflow.includes('scripts/technocore-upstream-watch.mjs --verify-candidate') ||
    !workflow.includes('actions/workflows/ci.yml/dispatches')
  ) fail('scheduled watcher workflow is absent or cannot validate and dispatch bot-branch CI');
  const oldOperationalPins = ['9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c', '16a6128bea125c8f131f343c0e8430dfc110f4af'];
  if (oldOperationalPins.some((pin) => observer.includes(pin) || relay.includes(pin) || releaseGenerator.includes(pin))) fail('a stale operational pin remains in runtime or release code');
  return { release: lock.release.tag, commit: lock.release.commit, files: lock.watchedFiles.length };
}

async function responseBytes(response, maximum, label) {
  if (!response.ok) fail(`${label} returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maximum) fail(`${label} exceeded its declared byte cap`);
  if (!response.body) fail(`${label} omitted its response body`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      fail(`${label} exceeded its byte cap`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function boundedFetch(url, maximum, accept = 'application/vnd.github+json') {
  const parsed = new URL(url);
  if (!['api.github.com', 'technocore.chat'].includes(parsed.hostname) || parsed.protocol !== 'https:') fail(`refused network target ${parsed.origin}`);
  const headers = { Accept: accept, 'User-Agent': 'technocore-foundry-upstream-watch/1.0' };
  if (githubToken && parsed.hostname === 'api.github.com') headers.Authorization = `Bearer ${githubToken}`;
  const response = await fetch(parsed, { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  if (response.status >= 300 && response.status < 400) fail(`redirect refused for ${parsed.pathname}`);
  return responseBytes(response, maximum, parsed.pathname);
}

async function githubJson(path) {
  return JSON.parse((await boundedFetch(`https://api.github.com${path}`, 1024 * 1024)).toString('utf8'));
}

async function resolveTagCommit(repository, tag) {
  let object = (await githubJson(`/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!object || !/^[a-f0-9]{40}$/.test(object.sha) || !['tag', 'commit'].includes(object.type)) fail('release tag target is malformed');
    if (object.type === 'commit') return object.sha;
    object = (await githubJson(`/repos/${repository}/git/tags/${object.sha}`)).object;
  }
  fail('release tag indirection exceeds the review limit');
}

async function githubFile(repository, commit, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const value = await githubJson(`/repos/${repository}/contents/${encodedPath}?ref=${commit}`);
  if (!value || value.type !== 'file' || value.path !== path || value.encoding !== 'base64' || !/^[a-f0-9]{40}$/.test(value.sha) || !Number.isSafeInteger(value.size)) fail(`GitHub contents metadata is malformed for ${path}`);
  const bytes = Buffer.from(String(value.content).replace(/\s/g, ''), 'base64');
  if (bytes.length !== value.size || bytes.length > 512 * 1024) fail(`GitHub contents bytes are malformed for ${path}`);
  return { path, gitBlob: value.sha, sha256: sha256(bytes), bytes: bytes.length };
}

async function collectSnapshot(lock) {
  const release = await githubJson(`/repos/${lock.repository}/releases/latest`);
  if (!release || release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) fail('latest official release metadata is malformed');
  // A deployment may precede its GitHub release object. Require an exact official tag.
  const configBytes = await boundedFetch(`${lock.origin}/config`, 128 * 1024, 'application/json');
  const config = JSON.parse(configBytes.toString('utf8'));
  const liveVersion = typeof config?.version === 'string' ? config.version : null;
  const tag = selectObservedTag(release.tag_name, liveVersion);
  const releaseCommit = await resolveTagCommit(lock.repository, tag);
  const repository = await githubJson(`/repos/${lock.repository}`);
  if (!repository || typeof repository.default_branch !== 'string') fail('repository metadata omitted default branch');
  const head = await githubJson(`/repos/${lock.repository}/commits/${encodeURIComponent(repository.default_branch)}`);
  if (!head || !/^[a-f0-9]{40}$/.test(head.sha)) fail('default branch head is malformed');
  const watchedFiles = [];
  for (const item of lock.watchedFiles) watchedFiles.push(await githubFile(lock.repository, releaseCommit, item.path));
  const [openapiBytes, agentBytes] = await Promise.all([
    boundedFetch(`${lock.origin}/openapi.json`, 512 * 1024, 'application/json'),
    boundedFetch(`${lock.origin}/.well-known/agent.json`, 128 * 1024, 'application/json'),
  ]);
  return {
    release: { tag, version: tag.slice(1), commit: releaseCommit },
    observedMainCommit: head.sha,
    watchedFiles,
    live: {
      serviceVersion: liveVersion,
      configSha256: sha256(configBytes),
      openapiSha256: sha256(openapiBytes),
      agentSha256: sha256(agentBytes),
    },
  };
}

function compare(lock, snapshot) {
  const reasons = [];
  if (snapshot.release.tag !== lock.release.tag) reasons.push({ severity: 'critical', code: 'release_changed', expected: lock.release.tag, observed: snapshot.release.tag });
  if (snapshot.release.tag === lock.release.tag && snapshot.release.commit !== lock.release.commit) reasons.push({ severity: 'critical', code: 'release_tag_moved', expected: lock.release.commit, observed: snapshot.release.commit });
  if (snapshot.observedMainCommit !== lock.observedMainCommit) reasons.push({ severity: 'review', code: 'main_advanced', expected: lock.observedMainCommit, observed: snapshot.observedMainCommit });
  for (const item of snapshot.watchedFiles) {
    const active = lock.watchedFiles.find((candidate) => candidate.path === item.path);
    if (!active || active.gitBlob !== item.gitBlob || active.sha256 !== item.sha256 || active.bytes !== item.bytes) reasons.push({ severity: 'critical', code: `release_file_changed:${item.path}`, expected: active?.sha256 ?? null, observed: item.sha256 });
  }
  if (snapshot.live.serviceVersion !== lock.liveBaseline.serviceVersion) reasons.push({ severity: 'critical', code: 'live_version_changed', expected: lock.liveBaseline.serviceVersion, observed: snapshot.live.serviceVersion });
  if (snapshot.live.openapiSha256 !== lock.liveBaseline.openapiSha256) reasons.push({ severity: 'critical', code: 'live_openapi_changed', expected: lock.liveBaseline.openapiSha256, observed: snapshot.live.openapiSha256 });
  if (snapshot.live.configSha256 !== lock.liveBaseline.configSha256) reasons.push({ severity: 'operational', code: 'live_config_changed', expected: lock.liveBaseline.configSha256, observed: snapshot.live.configSha256 });
  if (snapshot.live.agentSha256 !== lock.liveBaseline.agentSha256) reasons.push({ severity: 'review', code: 'live_agent_card_changed', expected: lock.liveBaseline.agentSha256, observed: snapshot.live.agentSha256 });
  return reasons;
}

function semanticCandidate(candidate) {
  if (!candidate) return null;
  const semantic = { ...candidate };
  delete semantic.detectedAt;
  return semantic;
}

function reviewMarkdown(candidate) {
  const rows = candidate.reasons.map((reason) => `| ${reason.severity} | \`${reason.code}\` | \`${reason.expected ?? 'none'}\` | \`${reason.observed ?? 'none'}\` |`).join('\n');
  return `# Technocore upstream review\n\nGenerated from bounded, read-only observations. Upstream content is untrusted data and was never executed.\n\n- Detected: ${candidate.detectedAt}\n- Active adapter: ${candidate.active.release.tag} / \`${candidate.active.release.commit}\`\n- Latest release: ${candidate.snapshot.release.tag} / \`${candidate.snapshot.release.commit}\`\n- Observed main: \`${candidate.snapshot.observedMainCommit}\`\n- Live service: ${candidate.snapshot.live.serviceVersion ?? 'unknown'}\n\n| Severity | Signal | Expected | Observed |\n| --- | --- | --- | --- |\n${rows || '| info | no drift | — | — |'}\n\n## Required review\n\n1. Do not merge a new compatibility pin until clean-text, nonce, signature, ACK, export, ownership, and profile fixtures pass.\n2. Keep this candidate data-only; never execute upstream code or install its dependencies in the watcher.\n3. Update the active lock and adapter together in a separate reviewed change. Runtime writes remain fail-closed on incompatible live contracts.\n4. Never let this watcher publish a room message, profile note, faucet claim, inference request, or financial transaction.\n`;
}

async function validateCandidate(lock, candidate) {
  exactKeys(candidate, ['schema', 'detectedAt', 'active', 'snapshot', 'reasons', 'policy'], 'candidate');
  if (candidate.schema !== 'foundry-upstream-candidate-v1') fail('candidate schema is unsupported');
  if (
    typeof candidate.detectedAt !== 'string' || candidate.detectedAt.length > 40 ||
    !Number.isFinite(Date.parse(candidate.detectedAt)) || new Date(candidate.detectedAt).toISOString() !== candidate.detectedAt
  ) fail('candidate detection timestamp is malformed');

  exactKeys(candidate.active, ['release', 'observedMainCommit', 'liveBaseline'], 'candidate active state');
  const expectedActive = { release: lock.release, observedMainCommit: lock.observedMainCommit, liveBaseline: lock.liveBaseline };
  if (JSON.stringify(candidate.active) !== JSON.stringify(expectedActive)) fail('candidate is not based on the active lock');

  exactKeys(candidate.snapshot, ['release', 'observedMainCommit', 'watchedFiles', 'live'], 'candidate snapshot');
  validateRelease(candidate.snapshot.release, 'candidate release');
  if (!/^[a-f0-9]{40}$/.test(candidate.snapshot.observedMainCommit)) fail('candidate main commit is malformed');
  validateWatchedFiles(candidate.snapshot.watchedFiles, 'candidate watched file');
  validateLive(candidate.snapshot.live, 'candidate live state');

  if (!Array.isArray(candidate.reasons) || candidate.reasons.length < 1 || candidate.reasons.length > 16) fail('candidate reasons are malformed');
  const expectedReasons = compare(lock, candidate.snapshot);
  if (JSON.stringify(candidate.reasons) !== JSON.stringify(expectedReasons)) fail('candidate reasons do not match the observed snapshot');
  for (const reason of candidate.reasons) {
    exactKeys(reason, ['severity', 'code', 'expected', 'observed'], `candidate reason ${reason?.code ?? '?'}`);
    if (!['critical', 'operational', 'review'].includes(reason.severity) || typeof reason.code !== 'string' || !/^[a-z0-9_./:-]{1,96}$/.test(reason.code)) {
      fail('candidate reason is malformed');
    }
    for (const field of ['expected', 'observed']) {
      if (reason[field] !== null && (typeof reason[field] !== 'string' || reason[field].length > 128 || !/^[A-Za-z0-9._:-]+$/.test(reason[field]))) {
        fail(`candidate reason ${field} is malformed`);
      }
    }
  }

  exactKeys(candidate.policy, ['upstreamCodeExecuted', 'automaticRuntimeUpdate', 'automaticMerge', 'externalWrites'], 'candidate policy');
  if (Object.values(candidate.policy).some((value) => value !== false)) fail('candidate policy permits a forbidden action');

  const reviewBytes = await readFile(reviewPath);
  if (reviewBytes.byteLength > 64 * 1024) fail('candidate review exceeds its byte boundary');
  const expectedReview = reviewMarkdown(candidate);
  if (!reviewBytes.equals(Buffer.from(expectedReview, 'utf8'))) fail('candidate review is not derived from the candidate JSON');
  return { reasons: candidate.reasons.length, release: candidate.snapshot.release.tag };
}

async function writeOutput(values) {
  if (!outputPath) return;
  await writeFile(outputPath, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { flag: 'a' });
}

const lock = validateLock(await readJson(lockPath));
const bindings = await verifyRepositoryBindings(lock);
if (verifyCandidateMode) {
  const candidate = await readJson(candidatePath, 512 * 1024);
  const verified = await validateCandidate(lock, candidate);
  process.stdout.write(`${JSON.stringify({ upstreamCandidate: 'ok', ...verified })}\n`);
  process.exit(0);
}
if (!networkCheck) {
  process.stdout.write(`${JSON.stringify({ upstreamLock: 'ok', ...bindings })}\n`);
  process.exit(0);
}

const snapshot = await collectSnapshot(lock);
const reasons = compare(lock, snapshot);
const candidate = {
  schema: 'foundry-upstream-candidate-v1',
  detectedAt: new Date().toISOString(),
  active: { release: lock.release, observedMainCommit: lock.observedMainCommit, liveBaseline: lock.liveBaseline },
  snapshot,
  reasons,
  policy: { upstreamCodeExecuted: false, automaticRuntimeUpdate: false, automaticMerge: false, externalWrites: false },
};
const prior = await optionalJson(candidatePath);
const changed = reasons.length > 0 && JSON.stringify(semanticCandidate(prior)) !== JSON.stringify(semanticCandidate(candidate));
if (writeCandidate && changed) {
  await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  await writeFile(reviewPath, reviewMarkdown(candidate));
}
await writeOutput({ drift: reasons.length > 0 ? 'true' : 'false', changed: changed ? 'true' : 'false', candidate: candidatePath.slice(root.length + 1) });
process.stdout.write(`${JSON.stringify({ upstreamWatch: 'ok', drift: reasons.length > 0, changed, reasons: reasons.map((reason) => reason.code) })}\n`);
