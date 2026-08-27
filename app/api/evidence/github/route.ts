import { findResult, upsertEvidenceCheck } from '@/db/queries';
import { type Tcr1Receipt, verifyTcr1Receipt } from '@/lib/foundry-crypto';
import { checkGitHubEvidence } from '@/lib/github-evidence';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let resultId = '';
  try {
    const payload = await request.json() as { resultId?: unknown };
    resultId = typeof payload.resultId === 'string' ? payload.resultId : '';
  } catch {
    return Response.json({ error: 'Expected a result identifier.' }, { status: 400 });
  }
  if (!/^res_[a-f0-9]{24}$/.test(resultId)) return Response.json({ error: 'Malformed result identifier.' }, { status: 400 });

  try {
    const result = await findResult(resultId);
    if (!result) return Response.json({ error: 'Result not found.' }, { status: 404 });
    const receipt = JSON.parse(result.receiptJson) as Tcr1Receipt;
    if (!(await verifyTcr1Receipt(receipt))) return Response.json({ error: 'Stored result receipt is invalid.' }, { status: 409 });
    const snapshot = await checkGitHubEvidence(receipt);
    await upsertEvidenceCheck({
      resultId,
      githubStatus: snapshot.github,
      ciStatus: snapshot.ci,
      identityBinding: snapshot.identityBinding,
      detail: snapshot.detail,
      snapshotJson: JSON.stringify(snapshot),
      checkedAt: snapshot.checkedAt,
    });
    return Response.json({ resultId, ...snapshot }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Evidence check is temporarily unavailable.' }, { status: 503 });
  }
}
