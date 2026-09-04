import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'protocol', 'upstream', 'tclk.lock.json');
const candidatePath = join(root, 'protocol', 'upstream', 'tclk.candidate.json');
const reviewPath = join(root, 'docs', 'TCLK_UPSTREAM_REVIEW.md');
const outputPath = process.env.GITHUB_OUTPUT;
const githubToken = process.env.GITHUB_TOKEN || '';
const args = new Set(process.argv.slice(2));
const writeCandidate = args.has('--write-candidate');
const verifyCandidateMode = args.has('--verify-candidate');
const networkCheck = writeCandidate || args.has('--check');
const watchedPaths = [
  'SPEC.md',
  'README.md',
  'CHANGELOG.md',
  'src/frames.ts',
  'src/machine.ts',
  'src/commitments.ts',
  'tests/vectors.test.ts',
  'tests/tclk.test.ts',
];

function fail(message) {
  throw new Error(`TCLK upstream watch: ${message}`);
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
    if (
      item.path !== watchedPaths[index] || !/^[a-f0-9]{40}$/.test(item.gitBlob) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 || item.bytes > 256 * 1024
    ) fail(`${label} metadata is malformed: ${item.path}`);
  }
}

function validateLock(lock) {
  exactKeys(lock, [
    'schema', 'authority', 'repository', 'release', 'operationalCommit',
    'observedMainCommit', 'watchedFiles', 'contract',
  ], 'lock');
  if (
    lock.schema !== 'foundry-tclk-upstream-lock-v1' ||
    lock.authority !== 'official-reviewed-commit' ||
    lock.repository !== 'flop-labs/tclk'
  ) fail('authority target is not allow-listed');
  validateRelease(lock.release, 'release');
  if (!/^[a-f0-9]{40}$/.test(lock.operationalCommit) || !/^[a-f0-9]{40}$/.test(lock.observedMainCommit)) fail('reviewed commit pin is malformed');
  if (lock.operationalCommit !== lock.observedMainCommit) fail('active TCLK adapter must equal the reviewed main snapshot');
  validateWatchedFiles(lock.watchedFiles, 'watched file');
  exactKeys(lock.contract, [
    'version', 'prefix', 'domain', 'maxFrameCharacters', 'transportSignedFields',
    'terminalReceiptOutcomes', 'contradictoryReceiptRejected',
  ], 'reviewed contract');
  if (
    lock.contract.version !== 'tclk/1' || lock.contract.prefix !== 'tclk1 ' ||
    lock.contract.domain !== 'FLOP::tclk::v1' || lock.contract.maxFrameCharacters !== 4096 ||
    JSON.stringify(lock.contract.transportSignedFields) !== JSON.stringify(['room', 'nonce', 'text']) ||
    JSON.stringify(lock.contract.terminalReceiptOutcomes) !== JSON.stringify(['claimed', 'refunded', 'cancelled']) ||
    lock.contract.contradictoryReceiptRejected !== true
  ) fail('reviewed TCLK contract drifted');
  return lock;
}

async function readJson(file, maximum = 1024 * 1024) {
  const bytes = await readFile(file);
  if (bytes.byteLength < 2 || bytes.byteLength > maximum) fail(`${file.slice(root.length + 1)} exceeds its byte boundary`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`${file.slice(root.length + 1)} is not valid UTF-8`); }
  let value;
  try { value = JSON.parse(source); } catch { fail(`${file.slice(root.length + 1)} is not valid JSON`); }
  if (source !== `${JSON.stringify(value, null, 2)}\n`) fail(`${file.slice(root.length + 1)} is not canonical JSON`);
  return value;
}

async function optionalJson(file) {
  try { return await readJson(file); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function verifyRepositoryBindings(lock) {
  const [contract, inspector, packageJson, workflow] = await Promise.all([
    readFile(join(root, 'lib', 'tclk-contract.ts'), 'utf8'),
    readFile(join(root, 'lib', 'browser-tclk-inspector.mjs'), 'utf8'),
    readJson(join(root, 'package.json')),
    readFile(join(root, '.github', 'workflows', 'tclk-upstream-watch.yml'), 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error)),
  ]);
  if (!contract.includes('protocol/upstream/tclk.lock.json') || !inspector.includes("from './tclk-contract.ts'")) fail('runtime TCLK constants are not derived from the lock');
  if (!packageJson.scripts?.['tclk:upstream:verify'] || !packageJson.scripts?.['tclk:upstream:check']) fail('package scripts do not expose TCLK lock verification and network watch');
  if (!workflow.includes('scripts/tclk-upstream-watch.mjs --write-candidate')) fail('scheduled TCLK watcher workflow is absent');
  return { release: lock.release.tag, commit: lock.operationalCommit, files: lock.watchedFiles.length };
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

async function boundedGithub(path, maximum = 1024 * 1024) {
  const url = new URL(`https://api.github.com${path}`);
  if (url.hostname !== 'api.github.com' || url.protocol !== 'https:') fail(`refused network target ${url.origin}`);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'technocore-foundry-tclk-watch/1.0' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  if (response.status >= 300 && response.status < 400) fail(`redirect refused for ${url.pathname}`);
  return responseBytes(response, maximum, url.pathname);
}

async function githubJson(path) {
  return JSON.parse((await boundedGithub(path)).toString('utf8'));
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
  if (
    !value || value.type !== 'file' || value.path !== path || value.encoding !== 'base64' ||
    !/^[a-f0-9]{40}$/.test(value.sha) || !Number.isSafeInteger(value.size)
  ) fail(`GitHub contents metadata is malformed for ${path}`);
  const bytes = Buffer.from(String(value.content).replace(/\s/g, ''), 'base64');
  if (bytes.length !== value.size || bytes.length > 256 * 1024) fail(`GitHub contents bytes are malformed for ${path}`);
  return { path, gitBlob: value.sha, sha256: sha256(bytes), bytes: bytes.length };
}

async function collectSnapshot(lock) {
  const latest = await githubJson(`/repos/${lock.repository}/releases/latest`);
  if (!latest || latest.draft || latest.prerelease || !/^v\d+\.\d+\.\d+$/.test(latest.tag_name)) fail('latest official release metadata is malformed');
  const releaseCommit = await resolveTagCommit(lock.repository, latest.tag_name);
  const repository = await githubJson(`/repos/${lock.repository}`);
  if (!repository || typeof repository.default_branch !== 'string') fail('repository metadata omitted default branch');
  const head = await githubJson(`/repos/${lock.repository}/commits/${encodeURIComponent(repository.default_branch)}`);
  if (!head || !/^[a-f0-9]{40}$/.test(head.sha)) fail('default branch head is malformed');
  const watchedFiles = [];
  for (const item of lock.watchedFiles) watchedFiles.push(await githubFile(lock.repository, head.sha, item.path));
  return {
    release: { tag: latest.tag_name, version: latest.tag_name.slice(1), commit: releaseCommit },
    observedMainCommit: head.sha,
    watchedFiles,
  };
}

function compare(lock, snapshot) {
  const reasons = [];
  if (snapshot.release.tag !== lock.release.tag) reasons.push({ severity: 'critical', code: 'release_changed', expected: lock.release.tag, observed: snapshot.release.tag });
  if (snapshot.release.tag === lock.release.tag && snapshot.release.commit !== lock.release.commit) reasons.push({ severity: 'critical', code: 'release_tag_moved', expected: lock.release.commit, observed: snapshot.release.commit });
  if (snapshot.observedMainCommit !== lock.observedMainCommit) reasons.push({ severity: 'review', code: 'main_advanced', expected: lock.observedMainCommit, observed: snapshot.observedMainCommit });
  for (const item of snapshot.watchedFiles) {
    const active = lock.watchedFiles.find((candidate) => candidate.path === item.path);
    if (!active || active.gitBlob !== item.gitBlob || active.sha256 !== item.sha256 || active.bytes !== item.bytes) {
      reasons.push({ severity: 'critical', code: `file_changed:${item.path}`, expected: active?.sha256 ?? null, observed: item.sha256 });
    }
  }
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
  return `# TCLK upstream review\n\nGenerated from bounded, read-only observations. Upstream content is untrusted data and was never executed.\n\n- Detected: ${candidate.detectedAt}\n- Active adapter: \`${candidate.active.operationalCommit}\`\n- Latest release: ${candidate.snapshot.release.tag} / \`${candidate.snapshot.release.commit}\`\n- Observed main: \`${candidate.snapshot.observedMainCommit}\`\n\n| Severity | Signal | Expected | Observed |\n| --- | --- | --- | --- |\n${rows}\n\n## Required review\n\n1. Keep this candidate data-only. Never execute TCLK upstream code or install its dependencies in this watcher.\n2. Compare SPEC, frame shapes, canonical bytes, id commitments, state transitions, contradictory receipts, and official vectors.\n3. Update the lock and local inspector together only after conformance tests pass. Never auto-merge a protocol change.\n4. This watcher must never publish an offer, room message, settlement instruction, faucet claim, inference request, or financial transaction.\n`;
}

async function validateCandidate(lock, candidate) {
  exactKeys(candidate, ['schema', 'detectedAt', 'active', 'snapshot', 'reasons', 'policy'], 'candidate');
  if (candidate.schema !== 'foundry-tclk-upstream-candidate-v1') fail('candidate schema is unsupported');
  if (
    typeof candidate.detectedAt !== 'string' || candidate.detectedAt.length > 40 ||
    !Number.isFinite(Date.parse(candidate.detectedAt)) || new Date(candidate.detectedAt).toISOString() !== candidate.detectedAt
  ) fail('candidate detection timestamp is malformed');
  exactKeys(candidate.active, ['release', 'operationalCommit', 'observedMainCommit'], 'candidate active state');
  if (JSON.stringify(candidate.active) !== JSON.stringify({ release: lock.release, operationalCommit: lock.operationalCommit, observedMainCommit: lock.observedMainCommit })) {
    fail('candidate is not based on the active lock');
  }
  exactKeys(candidate.snapshot, ['release', 'observedMainCommit', 'watchedFiles'], 'candidate snapshot');
  validateRelease(candidate.snapshot.release, 'candidate release');
  if (!/^[a-f0-9]{40}$/.test(candidate.snapshot.observedMainCommit)) fail('candidate main commit is malformed');
  validateWatchedFiles(candidate.snapshot.watchedFiles, 'candidate watched file');
  if (!Array.isArray(candidate.reasons) || candidate.reasons.length < 1 || candidate.reasons.length > 16) fail('candidate reasons are malformed');
  if (JSON.stringify(candidate.reasons) !== JSON.stringify(compare(lock, candidate.snapshot))) fail('candidate reasons do not match the observed snapshot');
  for (const reason of candidate.reasons) {
    exactKeys(reason, ['severity', 'code', 'expected', 'observed'], `candidate reason ${reason?.code ?? '?'}`);
    if (!['critical', 'review'].includes(reason.severity) || typeof reason.code !== 'string' || !/^[A-Za-z0-9_./:-]{1,96}$/.test(reason.code)) fail('candidate reason is malformed');
    for (const field of ['expected', 'observed']) {
      if (reason[field] !== null && (typeof reason[field] !== 'string' || reason[field].length > 128 || !/^[A-Za-z0-9._:-]+$/.test(reason[field]))) fail(`candidate reason ${field} is malformed`);
    }
  }
  exactKeys(candidate.policy, ['upstreamCodeExecuted', 'automaticRuntimeUpdate', 'automaticMerge', 'externalWrites'], 'candidate policy');
  if (Object.values(candidate.policy).some((value) => value !== false)) fail('candidate policy permits a forbidden action');
  const reviewBytes = await readFile(reviewPath);
  if (reviewBytes.byteLength > 64 * 1024 || !reviewBytes.equals(Buffer.from(reviewMarkdown(candidate), 'utf8'))) fail('candidate review is not derived from candidate JSON');
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
  process.stdout.write(`${JSON.stringify({ tclkUpstreamCandidate: 'ok', ...verified })}\n`);
  process.exit(0);
}
if (!networkCheck) {
  process.stdout.write(`${JSON.stringify({ tclkUpstreamLock: 'ok', ...bindings })}\n`);
  process.exit(0);
}

const snapshot = await collectSnapshot(lock);
const reasons = compare(lock, snapshot);
const candidate = {
  schema: 'foundry-tclk-upstream-candidate-v1',
  detectedAt: new Date().toISOString(),
  active: { release: lock.release, operationalCommit: lock.operationalCommit, observedMainCommit: lock.observedMainCommit },
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
process.stdout.write(`${JSON.stringify({ tclkUpstreamWatch: 'ok', drift: reasons.length > 0, changed, reasons: reasons.map((reason) => reason.code) })}\n`);
