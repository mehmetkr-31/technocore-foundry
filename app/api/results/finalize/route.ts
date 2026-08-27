import { createFinalization, findFinalization, findResult } from '@/db/queries';
import { canonicalJson, sha256Hex, tcr1ClaimantDid, type Tcr1Receipt, verifyTcr1Receipt } from '@/lib/foundry-crypto';
import { validateGitHubEvidence } from '@/lib/github-evidence';
import { persistReceipt } from '@/lib/server-receipts';
import { parseStrictJson, parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function withoutAcceptance(evidence: Tcr1Receipt['evidence']) {
  if (!evidence) return undefined;
  const rest = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'acceptance_sha256'));
  return Object.keys(rest).length ? rest : undefined;
}

export async function POST(request: Request) {
  let resultId = '';
  let receipt: Tcr1Receipt;
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 64 * 1024) throw new Error('oversized');
    const payload = parseStrictJsonBytes(raw) as { resultId?: unknown; receipt?: unknown };
    resultId = typeof payload.resultId === 'string' ? payload.resultId : '';
    receipt = payload.receipt as Tcr1Receipt;
  } catch {
    return Response.json({ error: 'Expected a small final TCR-1 document.' }, { status: 400 });
  }
  if (!/^res_[a-f0-9]{24}$/.test(resultId)) return Response.json({ error: 'Malformed result identifier.' }, { status: 400 });

  try {
    if (!(await verifyTcr1Receipt(receipt))) return Response.json({ error: 'Final TCR-1 schema or signature is invalid.' }, { status: 400 });
    const claimantDid = tcr1ClaimantDid(receipt);
    if (!claimantDid) return Response.json({ error: 'Final TCR-1 claimant DID is invalid.' }, { status: 400 });
    if (Math.abs(Date.now() - Date.parse(receipt.created_at)) > 10 * 60 * 1000) {
      return Response.json({ error: 'Finalization timestamp is outside the 10 minute window.' }, { status: 400 });
    }
    const result = await findResult(resultId);
    if (!result) return Response.json({ error: 'Result not found.' }, { status: 404 });
    if (await findFinalization(resultId)) return Response.json({ error: 'This result already has a final TCR-1.' }, { status: 409 });
    if (result.acceptanceDecision !== 'accepted' || !result.acceptanceReceiptSha256) {
      return Response.json({ error: 'An accepted issuer decision is required before finalization.' }, { status: 409 });
    }
    const original = parseStrictJson(result.receiptJson) as Tcr1Receipt;
    if (
      claimantDid !== result.actorDid ||
      canonicalJson(receipt.task) !== canonicalJson(original.task) ||
      canonicalJson(receipt.artifacts) !== canonicalJson(original.artifacts) ||
      canonicalJson(withoutAcceptance(receipt.evidence)) !== canonicalJson(withoutAcceptance(original.evidence))
    ) return Response.json({ error: 'Final TCR-1 must preserve the original task, artifact, and Git evidence.' }, { status: 409 });
    if (receipt.evidence?.acceptance_sha256 !== result.acceptanceReceiptSha256) {
      return Response.json({ error: 'Final TCR-1 does not bind the stored issuer acceptance.' }, { status: 409 });
    }
    validateGitHubEvidence(receipt.evidence);

    const receiptJson = canonicalJson(receipt);
    const receiptSha256 = await sha256Hex(receiptJson);
    const receiptId = `tcf_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id: receiptId,
      schema: 'technocore-task-receipt:1:final',
      actorDid: claimantDid,
      missionId: result.missionId,
      createdAt: receipt.created_at,
      payload: receipt,
    });
    await createFinalization({ resultId, receiptId, receiptJson, receiptSha256, createdAt: receipt.created_at });
    return Response.json({
      resultId,
      id: receiptId,
      receipt,
      sha256: `sha256:${receiptSha256}`,
      portableUrl: `/receipt/${receiptId}`,
      rawUrl: `/api/receipts/${receiptId}`,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'This result already has a final TCR-1.' }, { status: 409 });
    if (/GitHub|repository|Actions|commit/i.test(message)) return Response.json({ error: message }, { status: 400 });
    return Response.json({ error: 'Final TCR-1 could not be recorded.' }, { status: 503 });
  }
}
