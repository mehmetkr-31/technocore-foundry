import assert from 'node:assert/strict';
import {
  canonicalJson,
  createVault,
  sha256Hex,
  signEvent,
  signTcr1,
} from '../packages/signer-cli/core.mjs';
import { deriveContributionDossierLayers, verifyContributionDossierBytes } from '../packages/signer-cli/dossier.mjs';

const passphrase = 'dossier-test-passphrase';
const claimantVault = createVault(passphrase, new Date('2026-08-28T00:00:00.000Z'));
const issuerVault = createVault(passphrase, new Date('2026-08-28T00:00:00.000Z'));
const missionId = 'M-042';
const resultId = 'res_111111111111111111111111';
const requirementsHash = `sha256:${'2'.repeat(64)}`;
const artifact = Buffer.from('portable dossier artifact\n');
const artifactSha256 = sha256Hex(artifact);

const claimPayload = signEvent(claimantVault, passphrase, {
  schema: 'foundry-event-v1',
  type: 'claim',
  missionId,
  requirementsHash,
  actor: claimantVault.did,
  nonce: '2026082800000000001',
  createdAt: '2026-08-28T00:00:01.000Z',
});
const claimCanonical = canonicalJson(claimPayload);
const claimDigest = sha256Hex(claimCanonical);
const claimId = `frc_${claimDigest.slice(0, 24)}`;

const resultPayload = signTcr1(claimantVault, passphrase, {
  type: 'technocore-task-receipt',
  version: 1,
  task: { id: missionId, issuer: issuerVault.did, requirements_sha256: requirementsHash.slice(7) },
  claimant: { did: claimantVault.did },
  artifacts: [{
    type: 'text/plain',
    uri: `https://foundry.example/api/artifacts/${resultId}`,
    sha256: artifactSha256,
    size: artifact.length,
  }],
  created_at: '2026-08-28T00:00:02.000Z',
});
const resultCanonical = canonicalJson(resultPayload);
const resultDigest = sha256Hex(resultCanonical);

function embedded(id, kind, schema, actorDid, createdAt, payload) {
  const canonical = canonicalJson(payload);
  return {
    id,
    kind,
    schema,
    actorDid,
    createdAt,
    canonicalSha256: `sha256:${sha256Hex(canonical)}`,
    storedBytesSha256: `sha256:${sha256Hex(`${canonical}\n`)}`,
    rawPath: `/api/receipts/${id}`,
    proofPath: `/receipt/${id}`,
    payload,
  };
}

const dossier = {
  schema: 'foundry-contribution-dossier-v1',
  subject: {
    missionId,
    claimId,
    claimantDid: claimantVault.did,
    selectedResultId: resultId,
    selectedState: 'submitted',
  },
  snapshotAt: '2026-08-28T00:00:02.000Z',
  mission: {
    id: missionId,
    title: 'Seed mission for dossier verification',
    lane: 'TESTING / PROTOCOL',
    summary: 'Exercise an offline content-addressed proof compilation.',
    requirementsHash,
    issuerDid: issuerVault.did,
    status: 'open',
    createdAt: '2026-08-28T00:00:00.000Z',
    receiptId: null,
  },
  claim: {
    id: claimId,
    actorDid: claimantVault.did,
    createdAt: '2026-08-28T00:00:01.000Z',
    receiptId: claimId,
  },
  revisionChain: [{
    revision: 1,
    resultId,
    receiptId: resultId,
    resultReceiptSha256: `sha256:${resultDigest}`,
    createdAt: '2026-08-28T00:00:02.000Z',
    artifact: {
      name: 'artifact.txt',
      mediaType: 'text/plain',
      bytes: artifact.length,
      sha256: `sha256:${artifactSha256}`,
      downloadPath: `/api/artifacts/${resultId}`,
    },
    github: { claim: { repository: null, commit: null }, observation: null },
    revisionLink: null,
    issuerOutcome: { decision: null, changeRequestReceiptId: null, acceptanceReceiptId: null, finalReceiptId: null },
    executionEvidenceReceiptIds: [],
    reviewReceiptIds: [],
    attestationReceiptIds: [],
  }],
  receipts: [
    embedded(claimId, 'claim', 'foundry-event-v1', claimantVault.did, '2026-08-28T00:00:01.000Z', claimPayload),
    embedded(resultId, 'result', 'technocore-task-receipt:1', claimantVault.did, '2026-08-28T00:00:02.000Z', resultPayload),
  ],
  limitations: ['artifact_bytes_not_embedded', 'mission_receipt_unavailable'],
  caveats: ['This dossier does not establish authorship, reward, or eligibility.'],
};

const bytes = Buffer.from(canonicalJson(dossier));
const verified = verifyContributionDossierBytes(bytes, { artifactBytes: artifact });
assert.equal(verified.ok, true);
assert.equal(verified.layers.artifact, 'valid');
assert.match(verified.id, /^fds_[a-f0-9]{24}$/);
assert.throws(() => verifyContributionDossierBytes(Buffer.from(`${bytes.toString()}\n`)), /canonical/);
const tampered = structuredClone(dossier);
tampered.revisionChain[0].artifact.bytes += 1;
assert.throws(() => verifyContributionDossierBytes(Buffer.from(canonicalJson(tampered))), /bind|hash|artifact/i);

const latestOnlyLayers = deriveContributionDossierLayers({
  revisionChain: [
    {
      issuerOutcome: { acceptanceReceiptId: null, changeRequestReceiptId: 'fcr_old' },
      executionEvidenceReceiptIds: ['fev_old'],
      reviewReceiptIds: ['frw_old'],
      attestationReceiptIds: ['fat_old'],
    },
    {
      issuerOutcome: { acceptanceReceiptId: 'fac_latest', changeRequestReceiptId: null },
      executionEvidenceReceiptIds: [],
      reviewReceiptIds: [],
      attestationReceiptIds: [],
    },
  ],
});
assert.equal(latestOnlyLayers.issuerOutcome, 'valid');
assert.equal(latestOnlyLayers.executionEvidence, 'absent');
assert.equal(latestOnlyLayers.structuredReview, 'absent');
assert.equal(latestOnlyLayers.peerEvidence, 'absent');

console.log(JSON.stringify({ dossierCore: 'ok', id: verified.id, layers: verified.layers }));
