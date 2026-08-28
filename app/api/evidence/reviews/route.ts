import { createEvidenceReceipt, findMission, findResult, listResultEvidenceReceipts } from '@/db/queries';
import {
  canonicalJson,
  REVIEW_DECISIONS,
  REVIEW_RECEIPT_SCHEMA,
  sha256Hex,
  type SignedReviewReceipt,
  verifyReviewReceipt,
} from '@/lib/foundry-crypto';
import { persistReceipt } from '@/lib/server-receipts';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function looksLikeReview(value: unknown): value is SignedReviewReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Partial<SignedReviewReceipt>;
  const receipt = envelope.receipt;
  return Boolean(
    receipt &&
    receipt.schema === REVIEW_RECEIPT_SCHEMA &&
    /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(receipt.missionId) &&
    /^res_[a-f0-9]{24}$/.test(receipt.resultId) &&
    /^sha256:[a-f0-9]{64}$/.test(receipt.resultReceiptSha256) &&
    typeof receipt.reviewerDid === 'string' && receipt.reviewerDid.length <= 160 &&
    Array.isArray(receipt.criteria) && receipt.criteria.length >= 1 && receipt.criteria.length <= 20 &&
    Array.isArray(receipt.findings) && receipt.findings.length <= 50 &&
    REVIEW_DECISIONS.includes(receipt.reviewDecision) &&
    Array.isArray(receipt.residualRisks) && receipt.residualRisks.length <= 20 &&
    typeof receipt.createdAt === 'string' &&
    envelope.signature?.algorithm === 'Ed25519' &&
    envelope.signature.domain === REVIEW_RECEIPT_SCHEMA &&
    typeof envelope.signature.value === 'string' && envelope.signature.value.length <= 512,
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 65_536) throw new Error('oversized');
    payload = parseStrictJsonBytes(raw);
  } catch {
    return Response.json({ error: 'Expected a small signed structured review receipt JSON document.' }, { status: 400 });
  }
  if (!looksLikeReview(payload)) return Response.json({ error: 'Malformed structured review receipt.' }, { status: 400 });
  if (Math.abs(Date.now() - Date.parse(payload.receipt.createdAt)) > 10 * 60 * 1000) {
    return Response.json({ error: 'Review timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifyReviewReceipt(payload))) return Response.json({ error: 'Reviewer signature is invalid.' }, { status: 400 });
    const [mission, result] = await Promise.all([
      findMission(payload.receipt.missionId),
      findResult(payload.receipt.resultId),
    ]);
    if (!mission || !result || result.missionId !== mission.id) {
      return Response.json({ error: 'Mission result not found.' }, { status: 404 });
    }
    if (payload.receipt.reviewerDid === result.actorDid || payload.receipt.reviewerDid === mission.issuerDid) {
      return Response.json({ error: 'Claimant and issuer cannot act as the independent structured reviewer.' }, { status: 403 });
    }
    if (payload.receipt.resultReceiptSha256 !== `sha256:${result.receiptSha256}`) {
      return Response.json({ error: 'Review does not bind the stored immutable result receipt.' }, { status: 409 });
    }
    if (result.commitSha) {
      if (payload.receipt.candidateCommit !== result.commitSha) {
        return Response.json({ error: 'Review candidate commit does not match the submitted GitHub evidence commit.' }, { status: 409 });
      }
    } else if (payload.receipt.candidateCommit !== undefined) {
      return Response.json({ error: 'Review cannot add a candidate commit that is absent from the stored result.' }, { status: 409 });
    }
    if (payload.receipt.verificationReceiptSha256) {
      const evidence = await listResultEvidenceReceipts(result.id);
      const matches = evidence.some((receipt) =>
        receipt.kind === 'verification' &&
        `sha256:${receipt.receiptSha256}` === payload.receipt.verificationReceiptSha256,
      );
      if (!matches) {
        return Response.json({ error: 'Review references execution evidence that is not bound to this result.' }, { status: 409 });
      }
    }

    const receiptSha256 = await sha256Hex(canonicalJson(payload));
    const id = `frw_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id,
      schema: REVIEW_RECEIPT_SCHEMA,
      actorDid: payload.receipt.reviewerDid,
      missionId: result.missionId,
      createdAt: payload.receipt.createdAt,
      payload,
    });
    await createEvidenceReceipt({
      id,
      resultId: result.id,
      missionId: result.missionId,
      kind: 'review',
      actorDid: payload.receipt.reviewerDid,
      receiptSha256,
      createdAt: payload.receipt.createdAt,
    });
    return Response.json({
      id,
      receipt: payload,
      sha256: `sha256:${receiptSha256}`,
      portableUrl: `/receipt/${id}`,
      rawUrl: `/api/receipts/${id}`,
      layer: 'structured_review',
      reviewerRole: 'independent',
      doesNotConstitute: 'issuer_acceptance',
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'This reviewer already recorded a structured review for this result.' }, { status: 409 });
    return Response.json({ error: 'Structured review could not be recorded.' }, { status: 503 });
  }
}
