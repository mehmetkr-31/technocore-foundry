import { createEvidenceReceipt, findResult } from '@/db/queries';
import {
  canonicalJson,
  sha256Hex,
  type SignedVerificationReceipt,
  VERIFICATION_RECEIPT_SCHEMA,
  verifyVerificationReceipt,
} from '@/lib/foundry-crypto';
import { persistReceipt } from '@/lib/server-receipts';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function looksLikeVerification(value: unknown): value is SignedVerificationReceipt {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<SignedVerificationReceipt>;
  const receipt = envelope.receipt;
  return Boolean(
    receipt &&
    receipt.schema === VERIFICATION_RECEIPT_SCHEMA &&
    /^res_[a-f0-9]{24}$/.test(receipt.resultId) &&
    /^sha256:[a-f0-9]{64}$/.test(receipt.resultReceiptSha256) &&
    /^[a-f0-9]{40}$/.test(receipt.candidateCommit) &&
    typeof receipt.verifierDid === 'string' &&
    Array.isArray(receipt.checks) &&
    receipt.checks.length >= 1 &&
    receipt.checks.length <= 20 &&
    typeof receipt.createdAt === 'string' &&
    envelope.signature?.algorithm === 'Ed25519' &&
    envelope.signature.domain === VERIFICATION_RECEIPT_SCHEMA &&
    typeof envelope.signature.value === 'string' &&
    envelope.signature.value.length <= 512,
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 32_768) throw new Error('oversized');
    payload = parseStrictJsonBytes(raw);
  } catch {
    return Response.json({ error: 'Expected a small signed verification receipt JSON document.' }, { status: 400 });
  }
  if (!looksLikeVerification(payload)) return Response.json({ error: 'Malformed verification receipt.' }, { status: 400 });
  if (Math.abs(Date.now() - Date.parse(payload.receipt.createdAt)) > 10 * 60 * 1000) {
    return Response.json({ error: 'Verification timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifyVerificationReceipt(payload))) return Response.json({ error: 'Verifier signature is invalid.' }, { status: 400 });
    const result = await findResult(payload.receipt.resultId);
    if (!result) return Response.json({ error: 'Result not found.' }, { status: 404 });
    if (payload.receipt.resultReceiptSha256 !== `sha256:${result.receiptSha256}`) {
      return Response.json({ error: 'Verification receipt does not bind the stored result receipt.' }, { status: 409 });
    }
    if (result.commitSha && payload.receipt.candidateCommit !== result.commitSha) {
      return Response.json({ error: 'Verification candidate commit does not match the submitted GitHub evidence commit.' }, { status: 409 });
    }
    if (!payload.receipt.checks.every((check) => check.exitCode === 0)) {
      return Response.json({ error: 'Verification receipts must contain only successful checks.' }, { status: 400 });
    }

    const receiptSha256 = await sha256Hex(canonicalJson(payload));
    const id = `fev_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id,
      schema: VERIFICATION_RECEIPT_SCHEMA,
      actorDid: payload.receipt.verifierDid,
      missionId: result.missionId,
      createdAt: payload.receipt.createdAt,
      payload,
    });
    await createEvidenceReceipt({
      id,
      resultId: result.id,
      missionId: result.missionId,
      kind: 'verification',
      actorDid: payload.receipt.verifierDid,
      receiptSha256,
      createdAt: payload.receipt.createdAt,
    });
    return Response.json({
      id,
      receipt: payload,
      sha256: `sha256:${receiptSha256}`,
      portableUrl: `/receipt/${id}`,
      rawUrl: `/api/receipts/${id}`,
      layer: 'execution_provenance',
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'This verifier already recorded execution evidence for this result.' }, { status: 409 });
    return Response.json({ error: 'Verification receipt could not be recorded.' }, { status: 503 });
  }
}
