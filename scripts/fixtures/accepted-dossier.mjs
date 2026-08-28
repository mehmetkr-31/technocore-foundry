import {
  canonicalJson,
  createVault,
  sha256Hex,
  signEvent,
  signTcr1,
} from '../../packages/signer-cli/core.mjs';
import { verifyContributionDossierBytes } from '../../packages/signer-cli/dossier.mjs';

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

export function createAcceptedDossierFixture(options = {}) {
  const passphrase = 'commons-test-passphrase';
  const claimantVault = createVault(passphrase, new Date('2026-08-28T00:00:00.000Z'));
  const issuerVault = createVault(passphrase, new Date('2026-08-28T00:00:00.000Z'));
  const missionId = 'F-C0FFEE01';
  const resultId = 'res_111111111111111111111111';
  const requirements = 'Verify one canonical dossier without network access and report the exact content address.';
  const requirementsHash = options.requirementsHash ?? `sha256:${sha256Hex(requirements)}`;
  const artifact = Buffer.from('portable Commons fixture artifact\n');
  const artifactSha256 = sha256Hex(artifact);

  const missionPayload = signEvent(issuerVault, passphrase, {
    schema: 'foundry-event-v1',
    type: 'mission',
    missionId,
    title: 'Reproduce a portable Commons fixture',
    lane: 'TESTING / PROTOCOL',
    summary: 'Exercise the offline Commons admission and deterministic index pipeline.',
    requirements,
    requirementsHash,
    actor: issuerVault.did,
    nonce: '2026082800000000001',
    createdAt: '2026-08-28T00:00:00.000Z',
  });
  const missionCanonical = canonicalJson(missionPayload);
  const missionIdReceipt = `fms_${sha256Hex(missionCanonical).slice(0, 24)}`;

  const claimPayload = signEvent(claimantVault, passphrase, {
    schema: 'foundry-event-v1',
    type: 'claim',
    missionId,
    requirementsHash,
    actor: claimantVault.did,
    nonce: '2026082800000000002',
    createdAt: '2026-08-28T00:00:01.000Z',
  });
  const claimCanonical = canonicalJson(claimPayload);
  const claimId = `frc_${sha256Hex(claimCanonical).slice(0, 24)}`;

  const resultPayload = signTcr1(claimantVault, passphrase, {
    type: 'technocore-task-receipt',
    version: 1,
    task: { id: missionId, issuer: issuerVault.did, requirements_sha256: requirementsHash.slice(7) },
    claimant: { did: claimantVault.did },
    artifacts: [{
      type: 'text/plain',
      uri: options.artifactUri ?? `https://proofs.example.org/api/artifacts/${resultId}`,
      sha256: artifactSha256,
      size: artifact.length,
    }],
    created_at: '2026-08-28T00:00:02.000Z',
    ...(options.repository ? { evidence: {
      repository: options.repository,
      ...(options.commit ? { commit: options.commit } : {}),
      ...(options.pullRequest ? { pull_request: options.pullRequest } : {}),
      ...(options.ciUrl ? { ci_url: options.ciUrl, ci_status: 'success' } : {}),
    } } : {}),
  });
  const resultCanonical = canonicalJson(resultPayload);
  const resultDigest = sha256Hex(resultCanonical);

  const acceptancePayload = signEvent(issuerVault, passphrase, {
    schema: 'foundry-event-v1',
    type: 'acceptance',
    missionId: options.acceptanceMissionId ?? missionId,
    resultId,
    resultSha256: `sha256:${resultDigest}`,
    decision: 'accepted',
    note: 'Fixture verified against the bounded mission requirements.',
    actor: issuerVault.did,
    nonce: '2026082800000000003',
    createdAt: '2026-08-28T00:00:03.000Z',
  });
  const acceptanceCanonical = canonicalJson(acceptancePayload);
  const acceptanceId = `fac_${sha256Hex(acceptanceCanonical).slice(0, 24)}`;
  const resultEvidence = resultPayload.evidence;
  const finalizationPayload = options.finalize ? signTcr1(claimantVault, passphrase, {
    type: 'technocore-task-receipt',
    version: 1,
    task: resultPayload.task,
    claimant: resultPayload.claimant,
    artifacts: resultPayload.artifacts.map((entry) => ({
      ...entry,
      ...(options.finalArtifactType ? { type: options.finalArtifactType } : {}),
    })),
    created_at: '2026-08-28T00:00:04.000Z',
    evidence: { ...(resultEvidence ?? {}), acceptance_sha256: sha256Hex(acceptanceCanonical) },
  }) : null;
  const finalizationCanonical = finalizationPayload ? canonicalJson(finalizationPayload) : null;
  const finalizationId = finalizationCanonical ? `tcf_${sha256Hex(finalizationCanonical).slice(0, 24)}` : null;

  const dossier = {
    schema: 'foundry-contribution-dossier-v1',
    subject: {
      missionId,
      claimId,
      claimantDid: claimantVault.did,
      selectedResultId: resultId,
      selectedState: options.finalize ? 'finalized' : 'accepted',
    },
    snapshotAt: options.finalize ? '2026-08-28T00:00:04.000Z' : '2026-08-28T00:00:03.000Z',
    mission: {
      id: missionId,
      title: 'Reproduce a portable Commons fixture',
      lane: 'TESTING / PROTOCOL',
      summary: 'Exercise the offline Commons admission and deterministic index pipeline.',
      requirementsHash,
      issuerDid: issuerVault.did,
      status: 'closed',
      createdAt: '2026-08-28T00:00:00.000Z',
      receiptId: missionIdReceipt,
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
      github: { claim: { repository: options.repository ?? null, commit: options.commit ?? null }, observation: null },
      revisionLink: null,
      issuerOutcome: { decision: 'accepted', changeRequestReceiptId: null, acceptanceReceiptId: acceptanceId, finalReceiptId: finalizationId },
      executionEvidenceReceiptIds: [],
      reviewReceiptIds: [],
      attestationReceiptIds: [],
    }],
    receipts: [
      embedded(missionIdReceipt, 'mission', 'foundry-event-v1', issuerVault.did, '2026-08-28T00:00:00.000Z', missionPayload),
      embedded(claimId, 'claim', 'foundry-event-v1', claimantVault.did, '2026-08-28T00:00:01.000Z', claimPayload),
      embedded(resultId, 'result', 'technocore-task-receipt:1', claimantVault.did, '2026-08-28T00:00:02.000Z', resultPayload),
      embedded(acceptanceId, 'acceptance', 'foundry-event-v1', issuerVault.did, '2026-08-28T00:00:03.000Z', acceptancePayload),
      ...(finalizationPayload && finalizationId ? [embedded(finalizationId, 'finalization', 'technocore-task-receipt:1:final', claimantVault.did, '2026-08-28T00:00:04.000Z', finalizationPayload)] : []),
    ].sort((left, right) => left.id.localeCompare(right.id)),
    limitations: ['artifact_bytes_not_embedded'],
    caveats: ['This synthetic fixture does not establish authorship, reward, or eligibility.'],
  };
  const bytes = Buffer.from(canonicalJson(dossier));
  return {
    artifact,
    dossier,
    bytes,
    verified: options.verifyCore === false ? null : verifyContributionDossierBytes(bytes, { artifactBytes: artifact }),
  };
}
