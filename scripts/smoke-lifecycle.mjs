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

async function signFoundryWith(signerKeyPair, event) {
  const input = joinBytes(new TextEncoder().encode('foundry-event-v1\0'), new TextEncoder().encode(JSON.stringify(canonical(event))));
  const signature = await crypto.subtle.sign('Ed25519', signerKeyPair.privateKey, input);
  return { event, signature: Buffer.from(signature).toString('base64url') };
}

async function signFoundry(event) {
  return signFoundryWith(keyPair, event);
}

const nonce = () => `${Date.now()}${crypto.getRandomValues(new Uint32Array(1))[0]}`;
const missionId = `F-${randomHex(4).toUpperCase()}`;
const requirements = 'Deliver one UTF-8 artifact, bind its exact hash, attach public GitHub evidence, and preserve every proof layer.';
const requirementsHash = `sha256:${await sha256(requirements)}`;
const mission = await jsonRequest('/api/missions', await signFoundry({
  schema: 'foundry-event-v1', type: 'mission', missionId,
  title: 'Phase 5 revision-chain smoke-test', lane: 'TESTING / PROTOCOL',
  summary: 'Exercise immutable revisions, signed change requests, issuer acceptance, final TCR-1, proof pages, and Atlas without a public Technocore write.',
  requirements, requirementsHash, actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));
const claim = await jsonRequest('/api/claims', await signFoundry({
  schema: 'foundry-event-v1', type: 'claim', missionId, requirementsHash,
  actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));

const artifactBytes = new TextEncoder().encode('Technocore Foundry Phase 5 root artifact.\n');
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
upload.set('artifact', new File([artifactBytes], 'phase-5-root.txt', { type: 'text/plain' }));
const resultResponse = await fetch(`${ORIGIN}/api/results`, { method: 'POST', body: upload, signal: AbortSignal.timeout(20_000) });
const result = await resultResponse.json();
if (!resultResponse.ok) throw new Error(`/api/results ${resultResponse.status}: ${JSON.stringify(result)}`);

const changeRequest = await jsonRequest('/api/change-requests', await signFoundry({
  schema: 'foundry-event-v1', type: 'change_request', missionId, resultId,
  resultSha256: result.sha256,
  note: 'Replace the root artifact with a revision that explicitly records the requested protocol-chain improvement.',
  actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));

const staleAcceptanceResponse = await fetch(`${ORIGIN}/api/acceptances`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(await signFoundry({
    schema: 'foundry-event-v1', type: 'acceptance', missionId, resultId,
    resultSha256: result.sha256, decision: 'accepted', note: 'This stale revision must not be accepted after a change request.',
    actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
  })),
  signal: AbortSignal.timeout(20_000),
});
if (staleAcceptanceResponse.status !== 409) {
  throw new Error(`Stale acceptance was not rejected: ${staleAcceptanceResponse.status}`);
}

const revisedArtifactBytes = new TextEncoder().encode('Technocore Foundry Phase 5 revised artifact with a hash-linked change-request response.\n');
const revisedResultId = `res_${randomHex(12)}`;
const revisedArtifacts = [{
  type: 'text/plain', uri: `${ORIGIN}/api/artifacts/${revisedResultId}`,
  sha256: await sha256(revisedArtifactBytes), size: revisedArtifactBytes.length,
}];
const revisedReceipt = await signTcr(keyPair, {
  type: 'technocore-task-receipt', version: 1, task, claimant: { did },
  artifacts: revisedArtifacts, created_at: new Date().toISOString(), evidence,
});
const revisedReceiptSha256 = `sha256:${await sha256(JSON.stringify(canonical(revisedReceipt)))}`;
const revisionEvent = await signFoundry({
  schema: 'foundry-event-v1', type: 'revision', missionId, claimId: claim.id,
  resultId: revisedResultId, resultSha256: revisedReceiptSha256,
  parentResultId: resultId, parentResultSha256: result.sha256,
  changeRequestId: changeRequest.id, changeRequestSha256: changeRequest.sha256,
  revision: 2, actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
});
const tamperedRevisionEvent = await signFoundry({
  ...revisionEvent.event,
  parentResultSha256: `sha256:${'0'.repeat(64)}`,
  nonce: nonce(),
  createdAt: new Date().toISOString(),
});
const tamperedUpload = new FormData();
tamperedUpload.set('resultId', revisedResultId);
tamperedUpload.set('receipt', JSON.stringify(revisedReceipt));
tamperedUpload.set('revisionEvent', JSON.stringify(tamperedRevisionEvent));
tamperedUpload.set('artifact', new File([revisedArtifactBytes], 'phase-5-revision-2.txt', { type: 'text/plain' }));
const tamperedResponse = await fetch(`${ORIGIN}/api/results/revise`, {
  method: 'POST', body: tamperedUpload, signal: AbortSignal.timeout(20_000),
});
if (tamperedResponse.status !== 409) {
  throw new Error(`Tampered parent hash was not rejected: ${tamperedResponse.status}`);
}
const revisionUpload = new FormData();
revisionUpload.set('resultId', revisedResultId);
revisionUpload.set('receipt', JSON.stringify(revisedReceipt));
revisionUpload.set('revisionEvent', JSON.stringify(revisionEvent));
revisionUpload.set('artifact', new File([revisedArtifactBytes], 'phase-5-revision-2.txt', { type: 'text/plain' }));
const revisionResponse = await fetch(`${ORIGIN}/api/results/revise`, {
  method: 'POST', body: revisionUpload, signal: AbortSignal.timeout(20_000),
});
const revision = await revisionResponse.json();
if (!revisionResponse.ok) throw new Error(`/api/results/revise ${revisionResponse.status}: ${JSON.stringify(revision)}`);

const evidenceCheck = await jsonRequest('/api/evidence/github', { resultId: revisedResultId });
if (evidenceCheck.github !== 'verified' || evidenceCheck.identityBinding !== 'not_established') {
  throw new Error(`Evidence separation failed: ${JSON.stringify(evidenceCheck)}`);
}
const acceptance = await jsonRequest('/api/acceptances', await signFoundry({
  schema: 'foundry-event-v1', type: 'acceptance', missionId, resultId: revisedResultId,
  resultSha256: revision.sha256, decision: 'accepted', note: 'Phase 5 smoke test verified the exact revised bytes and both hash-chain bindings.',
  actor: did, nonce: nonce(), createdAt: new Date().toISOString(),
}));
const peerKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const peerPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', peerKeyPair.publicKey));
const peerDidPayload = new Uint8Array(34);
peerDidPayload.set([0xed, 0x01]);
peerDidPayload.set(peerPublicKey, 2);
const peerDid = `did:key:z${base58(peerDidPayload)}`;
const attestation = await jsonRequest('/api/attestations', await signFoundryWith(peerKeyPair, {
  schema: 'foundry-event-v1', type: 'attestation', missionId, resultId: revisedResultId,
  resultSha256: revision.sha256, statement: 'reproduced',
  note: 'Independent peer reproduced the accepted artifact hash and inspected the portable receipt chain.',
  actor: peerDid, nonce: nonce(), createdAt: new Date().toISOString(),
}));
const finalReceipt = await signTcr(keyPair, {
  type: 'technocore-task-receipt', version: 1, task, claimant: { did },
  artifacts: revisedArtifacts, created_at: new Date().toISOString(),
  evidence: { ...evidence, acceptance_sha256: acceptance.sha256.slice('sha256:'.length) },
});
const finalization = await jsonRequest('/api/results/finalize', { resultId: revisedResultId, receipt: finalReceipt });
const detail = await jsonRequest(`/api/missions/${missionId}?actorDid=${encodeURIComponent(did)}`);
if (
  detail.actorResult?.id !== revisedResultId ||
  detail.actorResult?.revision !== 2 ||
  detail.actorResult?.parent?.resultId !== resultId ||
  detail.results.find((item) => item.id === resultId)?.changeRequest?.id !== changeRequest.id ||
  detail.actorResult?.revisionReceipt?.id !== revision.revisionReceipt.id ||
  detail.actorResult?.acceptance?.decision !== 'accepted' ||
  detail.actorResult?.evidenceCheck?.github !== 'verified' ||
  detail.actorResult?.finalization?.id !== finalization.id ||
  !detail.actorResult?.attestations?.some((item) => item.id === attestation.id && item.statement === 'reproduced')
) throw new Error(`Lifecycle detail mismatch: ${JSON.stringify(detail)}`);

const [rootProofPage, changeRequestProofPage, revisionProofPage, chainProofPage, attestationProofPage, finalProofPage, artifact, atlas] = await Promise.all([
  fetch(`${ORIGIN}/receipt/${resultId}`),
  fetch(`${ORIGIN}${changeRequest.portableUrl}`),
  fetch(`${ORIGIN}${revision.portableUrl}`),
  fetch(`${ORIGIN}${revision.revisionReceipt.portableUrl}`),
  fetch(`${ORIGIN}${attestation.portableUrl}`),
  fetch(`${ORIGIN}${finalization.portableUrl}`),
  fetch(`${ORIGIN}${revision.artifactUrl}`),
  jsonRequest('/api/atlas'),
]);
if (
  !rootProofPage.ok || !changeRequestProofPage.ok || !revisionProofPage.ok ||
  !chainProofPage.ok || !attestationProofPage.ok || !finalProofPage.ok || !artifact.ok ||
  await artifact.text() !== new TextDecoder().decode(revisedArtifactBytes)
) {
  throw new Error('Revision proof chain or artifact bytes did not round-trip.');
}
if (!atlas.contributions.some((item) => item.resultId === revisedResultId && item.finalizedReceiptId === finalization.id && item.attestationCount >= 1)) {
  throw new Error('Finalized accepted contribution did not appear in Atlas.');
}

console.log(JSON.stringify({
  mission: mission.mission.id,
  claim: claim.id,
  rootResult: result.id,
  changeRequest: changeRequest.id,
  revision: revision.id,
  revisionReceipt: revision.revisionReceipt.id,
  github: evidenceCheck.github,
  acceptance: acceptance.id,
  attestation: attestation.id,
  finalization: finalization.id,
  proofPages: [rootProofPage.status, changeRequestProofPage.status, revisionProofPage.status, chainProofPage.status, attestationProofPage.status, finalProofPage.status],
  artifact: artifact.status,
  atlas: 'present',
}));
