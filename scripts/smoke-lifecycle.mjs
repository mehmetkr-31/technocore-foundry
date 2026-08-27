const ORIGIN = process.env.FOUNDRY_ORIGIN ?? 'http://localhost:3000';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes) {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let output = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    output = BASE58[remainder] + output;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function joinBytes(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function randomHex(size) {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function jsonRequest(path, body) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function signTcr(keyPair, unsigned) {
  const input = joinBytes(new TextEncoder().encode('technocore-task-receipt:v1\0'), new TextEncoder().encode(JSON.stringify(canonical(unsigned))));
  const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, input);
  return { ...unsigned, signature: { algorithm: 'Ed25519', domain: 'technocore-task-receipt:v1', value: Buffer.from(signature).toString('base64url') } };
}

const commitResponse = await fetch('https://api.github.com/repos/flop-labs/technocore-chat/commits/main', {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'technocore-foundry-smoke/0.3' },
  signal: AbortSignal.timeout(10_000),
});
if (!commitResponse.ok) throw new Error(`Could not obtain a public Technocore commit: ${commitResponse.status}`);
const publicCommit = (await commitResponse.json()).sha;
if (!/^[a-f0-9]{40}$/.test(publicCommit)) throw new Error('GitHub returned a malformed commit SHA.');

const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
const didPayload = new Uint8Array(34);
didPayload.set([0xed, 0x01]);
didPayload.set(publicKey, 2);
const did = `did:key:z${base58(didPayload)}`;

async function signFoundry(event) {
  const input = joinBytes(new TextEncoder().encode('foundry-event-v1\0'), new TextEncoder().encode(JSON.stringify(canonical(event))));
  const signature = await crypto.subtle.sign('Ed25519', keyPair.privateKey, input);
  return { event, signature: Buffer.from(signature).toString('base64url') };
}

const nonce = () => `${Date.now()}${crypto.getRandomValues(new Uint32Array(1))[0]}`;
const missionId = `F-${randomHex(4).toUpperCase()}`;
const requirements = 'Deliver one UTF-8 artifact, bind its exact hash, attach public GitHub evidence, and preserve every proof layer.';
const requirementsHash = `sha256:${await sha256(requirements)}`;
const mission = await jsonRequest('/api/missions', await signFoundry({
  schema: 'foundry-event-v1', type: 'mission', missionId,
  title: 'Phase 3 lifecycle smoke-test', lane: 'TESTING / PROTOCOL',
  summary: 'Exercise evidence checks, issuer acceptance, final TCR-1, receipt pages, and Atlas without a public Technocore write.',
  requirements, requirementsHash, actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));
const claim = await jsonRequest('/api/claims', await signFoundry({
  schema: 'foundry-event-v1', type: 'claim', missionId, requirementsHash,
  actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));

const artifactBytes = new TextEncoder().encode('Technocore Foundry Phase 3 smoke artifact.\n');
const resultId = `res_${randomHex(12)}`;
const task = { id: missionId, issuer: did, requirements_sha256: requirementsHash.slice(7) };
const artifacts = [{
  type: 'text/plain', uri: `${ORIGIN}/api/artifacts/${resultId}`,
  sha256: await sha256(artifactBytes), size: artifactBytes.length,
}];
const evidence = { repository: 'https://github.com/flop-labs/technocore-chat', commit: publicCommit };
const initialReceipt = await signTcr(keyPair, {
  type: 'technocore-task-receipt', version: 1, task, claimant: { did },
  artifacts, created_at: new Date().toISOString(), evidence,
});
const upload = new FormData();
upload.set('resultId', resultId);
upload.set('claimId', claim.id);
upload.set('receipt', JSON.stringify(initialReceipt));
upload.set('artifact', new File([artifactBytes], 'phase-3-smoke.txt', { type: 'text/plain' }));
const resultResponse = await fetch(`${ORIGIN}/api/results`, { method: 'POST', body: upload, signal: AbortSignal.timeout(20_000) });
const result = await resultResponse.json();
if (!resultResponse.ok) throw new Error(`/api/results ${resultResponse.status}: ${JSON.stringify(result)}`);

const evidenceCheck = await jsonRequest('/api/evidence/github', { resultId });
if (evidenceCheck.github !== 'verified' || evidenceCheck.identityBinding !== 'not_established') {
  throw new Error(`Evidence separation failed: ${JSON.stringify(evidenceCheck)}`);
}
const acceptance = await jsonRequest('/api/acceptances', await signFoundry({
  schema: 'foundry-event-v1', type: 'acceptance', missionId, resultId,
  resultSha256: result.sha256, decision: 'accepted', note: 'Phase 3 smoke test verified exact bytes and lifecycle bindings.',
  actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));
const finalReceipt = await signTcr(keyPair, {
  type: 'technocore-task-receipt', version: 1, task, claimant: { did },
  artifacts, created_at: new Date().toISOString(),
  evidence: { ...evidence, acceptance_sha256: acceptance.sha256.slice('sha256:'.length) },
});
const finalization = await jsonRequest('/api/results/finalize', { resultId, receipt: finalReceipt });
const detail = await jsonRequest(`/api/missions/${missionId}?actorDid=${encodeURIComponent(did)}`);
if (
  detail.actorResult?.acceptance?.decision !== 'accepted' ||
  detail.actorResult?.evidenceCheck?.github !== 'verified' ||
  detail.actorResult?.finalization?.id !== finalization.id
) throw new Error(`Lifecycle detail mismatch: ${JSON.stringify(detail)}`);

const [proofPage, finalProofPage, artifact, atlas] = await Promise.all([
  fetch(`${ORIGIN}/receipt/${resultId}`),
  fetch(`${ORIGIN}${finalization.portableUrl}`),
  fetch(`${ORIGIN}${result.artifactUrl}`),
  jsonRequest('/api/atlas'),
]);
if (!proofPage.ok || !finalProofPage.ok || !artifact.ok || await artifact.text() !== new TextDecoder().decode(artifactBytes)) {
  throw new Error('Portable proof or artifact bytes did not round-trip.');
}
if (!atlas.contributions.some((item) => item.resultId === resultId && item.finalizedReceiptId === finalization.id)) {
  throw new Error('Finalized accepted contribution did not appear in Atlas.');
}

console.log(JSON.stringify({
  mission: mission.mission.id,
  claim: claim.id,
  result: result.id,
  github: evidenceCheck.github,
  acceptance: acceptance.id,
  finalization: finalization.id,
  proofPage: proofPage.status,
  finalProofPage: finalProofPage.status,
  artifact: artifact.status,
  atlas: 'present',
}));
