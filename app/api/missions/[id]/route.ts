import { findActorResult, findClaim, findMission, listMissionResults } from '@/db/queries';
import { parseStrictJson } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(id)) {
    return Response.json({ error: 'Invalid mission identifier.' }, { status: 400 });
  }
  const actorDid = new URL(request.url).searchParams.get('actorDid');
  if (actorDid && (!actorDid.startsWith('did:key:z6Mk') || actorDid.length > 160)) {
    return Response.json({ error: 'Invalid actor DID.' }, { status: 400 });
  }

  try {
    const mission = await findMission(id);
    if (!mission) return Response.json({ error: 'Mission not found.' }, { status: 404 });
    const [results, actorClaim, actorResult] = await Promise.all([
      listMissionResults(id),
      actorDid ? findClaim(id, actorDid) : Promise.resolve(null),
      actorDid ? findActorResult(id, actorDid) : Promise.resolve(null),
    ]);
    return Response.json({
      mission,
      actorClaim,
      actorResult: actorResult ? presentResult(actorResult) : null,
      results: results.map(presentResult),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Mission activity is temporarily unavailable.' }, { status: 503 });
  }
}

function presentResult(result: Awaited<ReturnType<typeof findActorResult>> & {}) {
  return {
    id: result.id,
    missionId: result.missionId,
    claimId: result.claimId,
    actorDid: result.actorDid,
    revision: result.revision,
    receipt: parseStrictJson(result.receiptJson),
    receiptSha256: `sha256:${result.receiptSha256}`,
    portableUrl: `/receipt/${result.finalReceiptId ?? result.id}`,
    rawUrl: `/api/receipts/${result.id}`,
    artifact: {
      name: result.artifactName,
      mediaType: result.artifactMediaType,
      sha256: `sha256:${result.artifactSha256}`,
      bytes: result.artifactBytes,
      url: `/api/artifacts/${result.id}`,
    },
    repositoryUrl: result.repositoryUrl,
    commitSha: result.commitSha,
    createdAt: result.createdAt,
    parent: result.parentResultId ? {
      resultId: result.parentResultId,
      receiptSha256: result.parentReceiptSha256 ? `sha256:${result.parentReceiptSha256}` : null,
    } : null,
    revisionReceipt: result.revisionReceiptId ? {
      id: result.revisionReceiptId,
      event: result.revisionEventJson ? parseStrictJson(result.revisionEventJson) : null,
      portableUrl: `/receipt/${result.revisionReceiptId}`,
      rawUrl: `/api/receipts/${result.revisionReceiptId}`,
    } : null,
    changeRequest: result.changeRequestId ? {
      id: result.changeRequestId,
      note: result.changeRequestNote,
      receiptSha256: result.changeRequestReceiptSha256 ? `sha256:${result.changeRequestReceiptSha256}` : null,
      createdAt: result.changeRequestCreatedAt,
      portableUrl: `/receipt/${result.changeRequestId}`,
      rawUrl: `/api/receipts/${result.changeRequestId}`,
    } : null,
    acceptance: result.acceptanceId ? {
      id: result.acceptanceId,
      decision: result.acceptanceDecision,
      note: result.acceptanceNote,
      receiptSha256: result.acceptanceReceiptSha256 ? `sha256:${result.acceptanceReceiptSha256}` : null,
      portableUrl: `/receipt/${result.acceptanceId}`,
      rawUrl: `/api/receipts/${result.acceptanceId}`,
    } : null,
    evidenceCheck: result.evidenceCheckedAt ? {
      github: result.evidenceGithubStatus,
      ci: result.evidenceCiStatus,
      identityBinding: result.evidenceIdentityBinding,
      detail: result.evidenceDetail,
      checkedAt: result.evidenceCheckedAt,
    } : null,
    finalization: result.finalReceiptId ? {
      id: result.finalReceiptId,
      receipt: result.finalReceiptJson ? parseStrictJson(result.finalReceiptJson) : null,
      receiptSha256: result.finalReceiptSha256 ? `sha256:${result.finalReceiptSha256}` : null,
      createdAt: result.finalCreatedAt,
      portableUrl: `/receipt/${result.finalReceiptId}`,
      rawUrl: `/api/receipts/${result.finalReceiptId}`,
    } : null,
  };
}
