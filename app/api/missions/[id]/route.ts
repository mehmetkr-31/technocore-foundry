import { findActorResult, findClaim, findMission, listMissionResults } from '@/db/queries';

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
    receipt: JSON.parse(result.receiptJson),
    receiptSha256: `sha256:${result.receiptSha256}`,
    portableUrl: `/api/receipts/${result.id}`,
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
    acceptance: result.acceptanceId ? {
      id: result.acceptanceId,
      decision: result.acceptanceDecision,
      note: result.acceptanceNote,
      receiptSha256: result.acceptanceReceiptSha256 ? `sha256:${result.acceptanceReceiptSha256}` : null,
      portableUrl: `/api/receipts/${result.acceptanceId}`,
    } : null,
  };
}
