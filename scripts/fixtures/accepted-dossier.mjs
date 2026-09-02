import {
  canonicalJson,
  createVault,
  sha256Hex,
  signEvent,
  signReview,
  signTcr1,
  signVerification,
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

function addressedEmbedded(prefix, kind, schema, actorDid, createdAt, payload) {
  const id = `${prefix}_${sha256Hex(canonicalJson(payload)).slice(0, 24)}`;
  return embedded(id, kind, schema, actorDid, createdAt, payload);
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

export function createFullLifecycleDossierFixture() {
  const passphrase = 'full-lifecycle-fixture-passphrase';
  const claimantVault = createVault(passphrase, new Date('2026-08-28T01:00:00.000Z'));
  const issuerVault = createVault(passphrase, new Date('2026-08-28T01:00:00.000Z'));
  const peerVault = createVault(passphrase, new Date('2026-08-28T01:00:00.000Z'));
  const missionId = 'F-F00DBABE';
  const rootResultId = 'res_aaaaaaaaaaaaaaaaaaaaaaaa';
  const finalResultId = 'res_bbbbbbbbbbbbbbbbbbbbbbbb';
  const repository = 'https://github.com/flop-labs/technocore-chat';
  const commit = '9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c';
  const requirements = 'Deliver a hash-linked revision, deterministic execution evidence, independent review, peer evidence, and final acceptance binding.';
  const requirementsHash = `sha256:${sha256Hex(requirements)}`;
  const rootArtifact = Buffer.from('full lifecycle root artifact\n');
  const finalArtifact = Buffer.from('full lifecycle revised and independently checked artifact\n');
  const rootArtifactSha256 = sha256Hex(rootArtifact);
  const finalArtifactSha256 = sha256Hex(finalArtifact);

  const missionPayload = signEvent(issuerVault, passphrase, {
    schema: 'foundry-event-v1', type: 'mission', missionId,
    title: 'Exercise the complete portable proof lifecycle', lane: 'TESTING / PROTOCOL',
    summary: 'Bind two revisions, deterministic execution, independent review, peer evidence, and issuer acceptance.',
    requirements, requirementsHash, actor: issuerVault.did,
    nonce: '2026082801000000001', createdAt: '2026-08-28T01:00:00.000Z',
  });
  const missionReceipt = addressedEmbedded('fms', 'mission', 'foundry-event-v1', issuerVault.did, '2026-08-28T01:00:00.000Z', missionPayload);
  const claimPayload = signEvent(claimantVault, passphrase, {
    schema: 'foundry-event-v1', type: 'claim', missionId, requirementsHash,
    actor: claimantVault.did, nonce: '2026082801000000002', createdAt: '2026-08-28T01:00:01.000Z',
  });
  const claimReceipt = addressedEmbedded('frc', 'claim', 'foundry-event-v1', claimantVault.did, '2026-08-28T01:00:01.000Z', claimPayload);
  const task = { id: missionId, issuer: issuerVault.did, requirements_sha256: requirementsHash.slice(7) };
  const rootArtifacts = [{
    type: 'text/plain', uri: `https://proofs.example.org/api/artifacts/${rootResultId}`,
    sha256: rootArtifactSha256, size: rootArtifact.length,
  }];
  const finalArtifacts = [{
    type: 'text/plain', uri: `https://proofs.example.org/api/artifacts/${finalResultId}`,
    sha256: finalArtifactSha256, size: finalArtifact.length,
  }];
  const evidence = { repository, commit };
  const rootPayload = signTcr1(claimantVault, passphrase, {
    type: 'technocore-task-receipt', version: 1, task, claimant: { did: claimantVault.did },
    artifacts: rootArtifacts, created_at: '2026-08-28T01:00:02.000Z', evidence,
  });
  const rootReceipt = embedded(rootResultId, 'result', 'technocore-task-receipt:1', claimantVault.did, '2026-08-28T01:00:02.000Z', rootPayload);
  const changePayload = signEvent(issuerVault, passphrase, {
    schema: 'foundry-event-v1', type: 'change_request', missionId, resultId: rootResultId,
    resultSha256: rootReceipt.canonicalSha256,
    note: 'Add deterministic execution, independent review, and peer evidence to a new immutable revision.',
    actor: issuerVault.did, nonce: '2026082801000000003', createdAt: '2026-08-28T01:00:03.000Z',
  });
  const changeReceipt = addressedEmbedded('fcr', 'change_request', 'foundry-event-v1', issuerVault.did, '2026-08-28T01:00:03.000Z', changePayload);
  const finalResultPayload = signTcr1(claimantVault, passphrase, {
    type: 'technocore-task-receipt', version: 1, task, claimant: { did: claimantVault.did },
    artifacts: finalArtifacts, created_at: '2026-08-28T01:00:04.000Z', evidence,
  });
  const finalResultReceipt = embedded(finalResultId, 'result', 'technocore-task-receipt:1', claimantVault.did, '2026-08-28T01:00:04.000Z', finalResultPayload);
  const revisionPayload = signEvent(claimantVault, passphrase, {
    schema: 'foundry-event-v1', type: 'revision', missionId, claimId: claimReceipt.id,
    resultId: finalResultId, resultSha256: finalResultReceipt.canonicalSha256,
    parentResultId: rootResultId, parentResultSha256: rootReceipt.canonicalSha256,
    changeRequestId: changeReceipt.id, changeRequestSha256: changeReceipt.canonicalSha256,
    revision: 2, actor: claimantVault.did,
    nonce: '2026082801000000004', createdAt: '2026-08-28T01:00:05.000Z',
  });
  const revisionReceipt = addressedEmbedded('frv', 'revision', 'foundry-event-v1', claimantVault.did, '2026-08-28T01:00:05.000Z', revisionPayload);
  const verificationPayload = signVerification(peerVault, passphrase, {
    schema: 'foundry-verification-receipt-v1', resultId: finalResultId,
    resultReceiptSha256: finalResultReceipt.canonicalSha256, candidateCommit: commit,
    verifierDid: peerVault.did,
    checks: [{
      id: 'fixture.full-lifecycle', executableSha256: `sha256:${sha256Hex('node')}`,
      argvSha256: `sha256:${sha256Hex('["npm","test"]')}`, exitCode: 0,
      stdoutSha256: `sha256:${sha256Hex('all checks passed')}`,
      stderrSha256: `sha256:${sha256Hex('')}`, durationMs: 420,
    }],
    createdAt: '2026-08-28T01:00:06.000Z',
  });
  const verificationReceipt = addressedEmbedded('fev', 'verification', 'foundry-verification-receipt-v1', peerVault.did, '2026-08-28T01:00:06.000Z', verificationPayload);
  const reviewPayload = signReview(peerVault, passphrase, {
    schema: 'foundry-review-receipt-v1', missionId, resultId: finalResultId,
    resultReceiptSha256: finalResultReceipt.canonicalSha256, candidateCommit: commit,
    reviewerDid: peerVault.did,
    criteria: [{ id: 'portable-proof', status: 'met', evidence: 'The exact revision, artifact digest, and deterministic check receipt were independently inspected.' }],
    findings: [], reviewDecision: 'approved', verificationReceiptSha256: verificationReceipt.canonicalSha256,
    residualRisks: ['Public GitHub account ownership remains separate from DID key control.'],
    createdAt: '2026-08-28T01:00:07.000Z',
  });
  const reviewReceipt = addressedEmbedded('frw', 'review', 'foundry-review-receipt-v1', peerVault.did, '2026-08-28T01:00:07.000Z', reviewPayload);
  const acceptancePayload = signEvent(issuerVault, passphrase, {
    schema: 'foundry-event-v1', type: 'acceptance', missionId, resultId: finalResultId,
    resultSha256: finalResultReceipt.canonicalSha256, decision: 'accepted',
    note: 'The revised artifact and all independent proof layers satisfy the mission requirements.',
    actor: issuerVault.did, nonce: '2026082801000000005', createdAt: '2026-08-28T01:00:08.000Z',
  });
  const acceptanceReceipt = addressedEmbedded('fac', 'acceptance', 'foundry-event-v1', issuerVault.did, '2026-08-28T01:00:08.000Z', acceptancePayload);
  const attestationPayload = signEvent(peerVault, passphrase, {
    schema: 'foundry-event-v1', type: 'attestation', missionId, resultId: finalResultId,
    resultSha256: finalResultReceipt.canonicalSha256, statement: 'reproduced',
    note: 'The peer reproduced the deterministic check and exact revised artifact digest.',
    actor: peerVault.did, nonce: '2026082801000000006', createdAt: '2026-08-28T01:00:09.000Z',
  });
  const attestationReceipt = addressedEmbedded('fat', 'attestation', 'foundry-event-v1', peerVault.did, '2026-08-28T01:00:09.000Z', attestationPayload);
  const finalizationPayload = signTcr1(claimantVault, passphrase, {
    type: 'technocore-task-receipt', version: 1, task, claimant: { did: claimantVault.did },
    artifacts: finalArtifacts, created_at: '2026-08-28T01:00:10.000Z',
    evidence: { ...evidence, acceptance_sha256: acceptanceReceipt.canonicalSha256.slice(7) },
  });
  const finalizationReceipt = addressedEmbedded('tcf', 'finalization', 'technocore-task-receipt:1:final', claimantVault.did, '2026-08-28T01:00:10.000Z', finalizationPayload);

  const dossier = {
    schema: 'foundry-contribution-dossier-v1',
    subject: {
      missionId, claimId: claimReceipt.id, claimantDid: claimantVault.did,
      selectedResultId: finalResultId, selectedState: 'finalized',
    },
    snapshotAt: '2026-08-28T01:00:10.000Z',
    mission: {
      id: missionId, title: 'Exercise the complete portable proof lifecycle', lane: 'TESTING / PROTOCOL',
      summary: 'Bind two revisions, deterministic execution, independent review, peer evidence, and issuer acceptance.',
      requirementsHash, issuerDid: issuerVault.did, status: 'closed',
      createdAt: '2026-08-28T01:00:00.000Z', receiptId: missionReceipt.id,
    },
    claim: { id: claimReceipt.id, actorDid: claimantVault.did, createdAt: '2026-08-28T01:00:01.000Z', receiptId: claimReceipt.id },
    revisionChain: [
      {
        revision: 1, resultId: rootResultId, receiptId: rootResultId,
        resultReceiptSha256: rootReceipt.canonicalSha256, createdAt: '2026-08-28T01:00:02.000Z',
        artifact: { name: 'root.txt', mediaType: 'text/plain', bytes: rootArtifact.length, sha256: `sha256:${rootArtifactSha256}`, downloadPath: `/api/artifacts/${rootResultId}` },
        github: { claim: { repository, commit }, observation: null }, revisionLink: null,
        issuerOutcome: { decision: null, changeRequestReceiptId: changeReceipt.id, acceptanceReceiptId: null, finalReceiptId: null },
        executionEvidenceReceiptIds: [], reviewReceiptIds: [], attestationReceiptIds: [],
      },
      {
        revision: 2, resultId: finalResultId, receiptId: finalResultId,
        resultReceiptSha256: finalResultReceipt.canonicalSha256, createdAt: '2026-08-28T01:00:04.000Z',
        artifact: { name: 'revised.txt', mediaType: 'text/plain', bytes: finalArtifact.length, sha256: `sha256:${finalArtifactSha256}`, downloadPath: `/api/artifacts/${finalResultId}` },
        github: { claim: { repository, commit }, observation: null },
        revisionLink: {
          parentResultId: rootResultId, parentReceiptSha256: rootReceipt.canonicalSha256,
          changeRequestReceiptId: changeReceipt.id, changeRequestReceiptSha256: changeReceipt.canonicalSha256,
          revisionReceiptId: revisionReceipt.id,
        },
        issuerOutcome: { decision: 'accepted', changeRequestReceiptId: null, acceptanceReceiptId: acceptanceReceipt.id, finalReceiptId: finalizationReceipt.id },
        executionEvidenceReceiptIds: [verificationReceipt.id], reviewReceiptIds: [reviewReceipt.id], attestationReceiptIds: [attestationReceipt.id],
      },
    ],
    receipts: [
      missionReceipt, claimReceipt, rootReceipt, changeReceipt, finalResultReceipt, revisionReceipt,
      verificationReceipt, reviewReceipt, acceptanceReceipt, attestationReceipt, finalizationReceipt,
    ].sort((left, right) => left.id.localeCompare(right.id)),
    limitations: ['artifact_bytes_not_embedded'],
    caveats: ['This synthetic fixture proves verifier parity only; it does not establish authorship, reward, or eligibility.'],
  };
  const bytes = Buffer.from(canonicalJson(dossier));
  return {
    artifact: finalArtifact,
    dossier,
    bytes,
    verified: verifyContributionDossierBytes(bytes, { artifactBytes: finalArtifact }),
  };
}
