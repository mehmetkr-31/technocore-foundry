import { env } from 'cloudflare:workers';
import {
  findClaimById,
  findEvidenceCheck,
  findLatestResultForClaim,
  findMission,
  findMissionSignature,
  findReceiptMetadata,
  findResult,
  listClaimResults,
  listResultAttestations,
  listResultEvidenceReceipts,
  type ResultRecord,
} from '@/db/queries';
import { canonicalJson, sha256Hex } from './foundry-crypto';
import { parseStrictJsonBytes } from './strict-json';

export const CONTRIBUTION_DOSSIER_SCHEMA = 'foundry-contribution-dossier-v1' as const;
export const MAX_DOSSIER_BYTES = 2 * 1024 * 1024;
export const MAX_DOSSIER_RECEIPTS = 256;

export type DossierReceiptKind =
  | 'mission'
  | 'claim'
  | 'result'
  | 'revision'
  | 'change_request'
  | 'verification'
  | 'review'
  | 'acceptance'
  | 'finalization'
  | 'attestation';

export type DossierReceipt = {
  id: string;
  kind: DossierReceiptKind;
  schema: string;
  actorDid: string;
  createdAt: string;
  canonicalSha256: string;
  storedBytesSha256: string;
  rawPath: string;
  proofPath: string;
  payload: unknown;
};

export type ContributionDossier = {
  schema: typeof CONTRIBUTION_DOSSIER_SCHEMA;
  subject: {
    missionId: string;
    claimId: string;
    claimantDid: string;
    selectedResultId: string;
    selectedState: 'submitted' | 'changes_requested' | 'rejected' | 'accepted' | 'finalized';
  };
  snapshotAt: string;
  mission: {
    id: string;
    title: string;
    lane: string;
    summary: string;
    requirementsHash: string;
    issuerDid: string;
    status: 'open' | 'closed';
    createdAt: string;
    receiptId: string | null;
  };
  claim: {
    id: string;
    actorDid: string;
    createdAt: string;
    receiptId: string;
  };
  revisionChain: Array<{
    revision: number;
    resultId: string;
    receiptId: string;
    resultReceiptSha256: string;
    createdAt: string;
    artifact: {
      name: string;
      mediaType: string;
      bytes: number;
      sha256: string;
      downloadPath: string;
    };
    github: {
      claim: {
        repository: string | null;
        commit: string | null;
      };
      observation: null | {
        signed: false;
        githubStatus: string;
        ciStatus: string;
        identityBinding: string;
        detail: string;
        checkedAt: string;
        snapshotCanonicalSha256: string;
      };
    };
    revisionLink: null | {
      parentResultId: string;
      parentReceiptSha256: string;
      changeRequestReceiptId: string;
      changeRequestReceiptSha256: string;
      revisionReceiptId: string;
    };
    issuerOutcome: {
      decision: 'accepted' | 'rejected' | null;
      changeRequestReceiptId: string | null;
      acceptanceReceiptId: string | null;
      finalReceiptId: string | null;
    };
    executionEvidenceReceiptIds: string[];
    reviewReceiptIds: string[];
    attestationReceiptIds: string[];
  }>;
  receipts: DossierReceipt[];
  limitations: string[];
  caveats: string[];
};

function selectedState(result: ResultRecord): ContributionDossier['subject']['selectedState'] {
  if (result.finalReceiptId) return 'finalized';
  if (result.acceptanceDecision === 'accepted') return 'accepted';
  if (result.acceptanceDecision === 'rejected') return 'rejected';
  if (result.changeRequestId) return 'changes_requested';
  return 'submitted';
}

function maxTimestamp(values: string[]) {
  const milliseconds = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!milliseconds.length) throw new Error('Dossier has no valid source timestamp.');
  return new Date(Math.max(...milliseconds)).toISOString();
}

async function loadReceipt(id: string, kind: DossierReceiptKind): Promise<DossierReceipt> {
  const metadata = await findReceiptMetadata(id);
  if (!metadata || !env.FILES) throw new Error(`Receipt ${id} is unavailable.`);
  const object = await env.FILES.get(metadata.objectKey);
  if (!object) throw new Error(`Receipt ${id} bytes are unavailable.`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  const storedBytesSha256 = await sha256Hex(bytes);
  if (storedBytesSha256 !== metadata.sha256 || bytes.byteLength !== metadata.bytes) {
    throw new Error(`Receipt ${id} storage hash does not match its metadata.`);
  }
  const payload = parseStrictJsonBytes(bytes);
  const canonicalSha256 = await sha256Hex(canonicalJson(payload));
  return {
    id,
    kind,
    schema: metadata.schema,
    actorDid: metadata.actorDid,
    createdAt: metadata.createdAt,
    canonicalSha256: `sha256:${canonicalSha256}`,
    storedBytesSha256: `sha256:${storedBytesSha256}`,
    rawPath: `/api/receipts/${id}`,
    proofPath: `/receipt/${id}`,
    payload,
  };
}

function assertChain(results: ResultRecord[], selected: ResultRecord) {
  if (!results.length || results.length !== selected.revision) throw new Error('Revision chain is incomplete.');
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.revision !== index + 1) throw new Error('Revision chain is not contiguous.');
    if (index === 0) {
      if (result.parentResultId || result.revisionReceiptId || result.revisionCauseChangeRequestId) {
        throw new Error('Root result contains unexpected revision links.');
      }
      continue;
    }
    const parent = results[index - 1];
    if (
      result.parentResultId !== parent.id ||
      result.parentReceiptSha256 !== parent.receiptSha256 ||
      !result.revisionCauseChangeRequestId ||
      !result.revisionCauseChangeRequestSha256 ||
      !result.revisionReceiptId ||
      !result.revisionEventJson ||
      !result.revisionSignature
    ) throw new Error('Revision chain link is incomplete or does not bind its parent.');
  }
}

export async function assembleContributionDossier(resultId: string) {
  const selected = await findResult(resultId);
  if (!selected) throw new Error('RESULT_NOT_FOUND');
  const latest = await findLatestResultForClaim(selected.claimId);
  if (!latest || latest.id !== selected.id) throw new Error('RESULT_NOT_LATEST');

  const [mission, missionSignature, claim, results] = await Promise.all([
    findMission(selected.missionId),
    findMissionSignature(selected.missionId),
    findClaimById(selected.claimId),
    listClaimResults(selected.claimId),
  ]);
  if (!mission || !claim || claim.missionId !== mission.id || claim.actorDid !== selected.actorDid) {
    throw new Error('Dossier mission, claim, and result bindings are inconsistent.');
  }
  assertChain(results, selected);

  const perResult = await Promise.all(results.map(async (result) => {
    const [evidenceCheck, evidenceReceipts, attestations] = await Promise.all([
      findEvidenceCheck(result.id),
      listResultEvidenceReceipts(result.id),
      listResultAttestations(result.id),
    ]);
    return { result, evidenceCheck, evidenceReceipts, attestations };
  }));

  const receiptKinds = new Map<string, DossierReceiptKind>();
  const addReceipt = (id: string | null | undefined, kind: DossierReceiptKind) => {
    if (!id) return;
    const existing = receiptKinds.get(id);
    if (existing && existing !== kind) throw new Error(`Receipt ${id} has conflicting dossier roles.`);
    receiptKinds.set(id, kind);
  };
  addReceipt(missionSignature?.receiptId, 'mission');
  addReceipt(claim.id, 'claim');
  for (const { result, evidenceReceipts, attestations } of perResult) {
    addReceipt(result.id, 'result');
    addReceipt(result.revisionReceiptId, 'revision');
    addReceipt(result.revisionCauseChangeRequestId, 'change_request');
    addReceipt(result.changeRequestId, 'change_request');
    addReceipt(result.acceptanceId, 'acceptance');
    addReceipt(result.finalReceiptId, 'finalization');
    for (const evidence of evidenceReceipts) addReceipt(evidence.id, evidence.kind);
    for (const attestation of attestations) addReceipt(attestation.id, 'attestation');
  }
  if (receiptKinds.size > MAX_DOSSIER_RECEIPTS) throw new Error('DOSSIER_TOO_LARGE');

  const receipts = await Promise.all(
    Array.from(receiptKinds.entries()).map(([id, kind]) => loadReceipt(id, kind)),
  );
  receipts.sort((left, right) => left.id.localeCompare(right.id));
  const proofById = new Map(receipts.map((receipt) => [receipt.id, receipt]));

  for (const { result, evidenceReceipts, attestations } of perResult) {
    if (proofById.get(result.id)?.canonicalSha256 !== `sha256:${result.receiptSha256}`) {
      throw new Error(`Result ${result.id} canonical receipt hash is inconsistent.`);
    }
    for (const evidence of evidenceReceipts) {
      if (proofById.get(evidence.id)?.canonicalSha256 !== `sha256:${evidence.receiptSha256}`) {
        throw new Error(`Evidence receipt ${evidence.id} canonical hash is inconsistent.`);
      }
    }
    for (const attestation of attestations) {
      if (proofById.get(attestation.id)?.canonicalSha256 !== `sha256:${attestation.receiptSha256}`) {
        throw new Error(`Attestation ${attestation.id} canonical hash is inconsistent.`);
      }
    }
    if (result.acceptanceId && proofById.get(result.acceptanceId)?.canonicalSha256 !== `sha256:${result.acceptanceReceiptSha256}`) {
      throw new Error(`Acceptance ${result.acceptanceId} canonical hash is inconsistent.`);
    }
    if (result.changeRequestId && proofById.get(result.changeRequestId)?.canonicalSha256 !== `sha256:${result.changeRequestReceiptSha256}`) {
      throw new Error(`Change request ${result.changeRequestId} canonical hash is inconsistent.`);
    }
    if (result.revisionCauseChangeRequestId && proofById.get(result.revisionCauseChangeRequestId)?.canonicalSha256 !== `sha256:${result.revisionCauseChangeRequestSha256}`) {
      throw new Error(`Revision cause ${result.revisionCauseChangeRequestId} canonical hash is inconsistent.`);
    }
    if (result.finalReceiptId && proofById.get(result.finalReceiptId)?.canonicalSha256 !== `sha256:${result.finalReceiptSha256}`) {
      throw new Error(`Finalization ${result.finalReceiptId} canonical hash is inconsistent.`);
    }
  }

  const timestamps = [mission.createdAt, claim.createdAt, ...receipts.map((receipt) => receipt.createdAt)];
  const revisionChain: ContributionDossier['revisionChain'] = [];
  for (const { result, evidenceCheck, evidenceReceipts, attestations } of perResult) {
    if (evidenceCheck) timestamps.push(evidenceCheck.checkedAt);
    const executionEvidence = evidenceReceipts.filter((receipt) => receipt.kind === 'verification');
    const reviews = evidenceReceipts.filter((receipt) => receipt.kind === 'review');
    revisionChain.push({
      revision: result.revision,
      resultId: result.id,
      receiptId: result.id,
      resultReceiptSha256: `sha256:${result.receiptSha256}`,
      createdAt: result.createdAt,
      artifact: {
        name: result.artifactName,
        mediaType: result.artifactMediaType,
        bytes: result.artifactBytes,
        sha256: `sha256:${result.artifactSha256}`,
        downloadPath: `/api/artifacts/${result.id}`,
      },
      github: {
        claim: { repository: result.repositoryUrl, commit: result.commitSha },
        observation: evidenceCheck ? {
          signed: false,
          githubStatus: evidenceCheck.githubStatus,
          ciStatus: evidenceCheck.ciStatus,
          identityBinding: evidenceCheck.identityBinding,
          detail: evidenceCheck.detail,
          checkedAt: evidenceCheck.checkedAt,
          snapshotCanonicalSha256: `sha256:${await sha256Hex(canonicalJson(parseStrictJsonBytes(new TextEncoder().encode(evidenceCheck.snapshotJson))))}`,
        } : null,
      },
      revisionLink: result.revision === 1 ? null : {
        parentResultId: result.parentResultId as string,
        parentReceiptSha256: `sha256:${result.parentReceiptSha256}`,
        changeRequestReceiptId: result.revisionCauseChangeRequestId as string,
        changeRequestReceiptSha256: `sha256:${result.revisionCauseChangeRequestSha256}`,
        revisionReceiptId: result.revisionReceiptId as string,
      },
      issuerOutcome: {
        decision: result.acceptanceDecision,
        changeRequestReceiptId: result.changeRequestId,
        acceptanceReceiptId: result.acceptanceId,
        finalReceiptId: result.finalReceiptId,
      },
      executionEvidenceReceiptIds: executionEvidence.map((receipt) => receipt.id),
      reviewReceiptIds: reviews.map((receipt) => receipt.id),
      attestationReceiptIds: attestations.map((attestation) => attestation.id),
    });
  }

  const limitations = ['artifact_bytes_not_embedded'];
  if (!missionSignature) limitations.push('mission_receipt_unavailable');
  const dossier: ContributionDossier = {
    schema: CONTRIBUTION_DOSSIER_SCHEMA,
    subject: {
      missionId: mission.id,
      claimId: claim.id,
      claimantDid: claim.actorDid,
      selectedResultId: selected.id,
      selectedState: selectedState(selected),
    },
    snapshotAt: maxTimestamp(timestamps),
    mission: {
      id: mission.id,
      title: mission.title,
      lane: mission.lane,
      summary: mission.summary,
      requirementsHash: mission.requirementsHash,
      issuerDid: mission.issuerDid,
      status: mission.status,
      createdAt: mission.createdAt,
      receiptId: missionSignature?.receiptId ?? null,
    },
    claim: {
      id: claim.id,
      actorDid: claim.actorDid,
      createdAt: claim.createdAt,
      receiptId: claim.id,
    },
    revisionChain,
    receipts,
    limitations,
    caveats: [
      'Signatures prove key control and byte integrity, not sole authorship or real-world identity.',
      'GitHub observations do not bind a GitHub account to the claimant DID.',
      'Structured review decisions do not constitute issuer acceptance.',
      'This dossier does not prove payment, reward entitlement, or airdrop eligibility.',
    ],
  };
  const bytes = new TextEncoder().encode(canonicalJson(dossier));
  if (bytes.byteLength > MAX_DOSSIER_BYTES) throw new Error('DOSSIER_TOO_LARGE');
  const sha256 = await sha256Hex(bytes);
  return { dossier, bytes, sha256, id: `fds_${sha256.slice(0, 24)}` };
}
