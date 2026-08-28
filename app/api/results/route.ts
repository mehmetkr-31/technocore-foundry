import { createResult, findClaimById, findMission, findResult } from '@/db/queries';
import { canonicalJson, sha256Hex, tcr1ClaimantDid, type Tcr1Receipt, verifyTcr1Receipt } from '@/lib/foundry-crypto';
import { validateGitHubEvidence } from '@/lib/github-evidence';
import { persistReceipt, putImmutableObject } from '@/lib/server-receipts';
import { parseStrictJson } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_ARTIFACT_BYTES + 64 * 1024) {
    return Response.json({ error: 'Artifact exceeds the 5 MB preview limit.' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected a multipart TCR-1 submission.' }, { status: 400 });
  }

  const resultId = String(form.get('resultId') ?? '');
  const claimId = String(form.get('claimId') ?? '');
  const receiptRaw = String(form.get('receipt') ?? '');
  const artifactFile = form.get('artifact');
  if (!/^res_[a-f0-9]{24}$/.test(resultId) || !/^frc_[a-f0-9]{24}$/.test(claimId)) {
    return Response.json({ error: 'Malformed result or claim identifier.' }, { status: 400 });
  }
  if (!(artifactFile instanceof File) || artifactFile.size < 1 || artifactFile.size > MAX_ARTIFACT_BYTES) {
    return Response.json({ error: 'Choose one non-empty artifact up to 5 MB.' }, { status: 400 });
  }

  let receipt: Tcr1Receipt;
  try {
    receipt = parseStrictJson(receiptRaw) as Tcr1Receipt;
  } catch {
    return Response.json({ error: 'Malformed TCR-1 receipt JSON.' }, { status: 400 });
  }

  try {
    if (await findResult(resultId)) {
      return Response.json({ error: 'Result identifier is already immutable.' }, { status: 409 });
    }
    if (!(await verifyTcr1Receipt(receipt))) {
      return Response.json({ error: 'TCR-1 schema or claimant signature is invalid.' }, { status: 400 });
    }
    const claimantDid = tcr1ClaimantDid(receipt);
    if (!claimantDid) return Response.json({ error: 'TCR-1 claimant DID is invalid.' }, { status: 400 });
    if (Math.abs(Date.now() - Date.parse(receipt.created_at)) > 10 * 60 * 1000) {
      return Response.json({ error: 'Result timestamp is outside the 10 minute window.' }, { status: 400 });
    }
    const mission = await findMission(receipt.task.id);
    const claim = await findClaimById(claimId);
    if (!mission || mission.status !== 'open') return Response.json({ error: 'Mission is missing or closed.' }, { status: 404 });
    if (!claim || claim.missionId !== mission.id || claim.actorDid !== claimantDid) {
      return Response.json({ error: 'This claimant does not hold the referenced mission claim.' }, { status: 403 });
    }
    if (
      receipt.task.issuer !== mission.issuerDid ||
      receipt.task.requirements_sha256 !== mission.requirementsHash.slice('sha256:'.length)
    ) return Response.json({ error: 'TCR-1 task binding does not match the mission.' }, { status: 409 });

    const artifact = receipt.artifacts[0];
    const expectedUri = new URL(`/api/artifacts/${resultId}`, request.url).toString();
    if (receipt.artifacts.length !== 1 || artifact.uri !== expectedUri || artifact.size !== artifactFile.size) {
      return Response.json({ error: 'Artifact URI or declared size does not match the upload.' }, { status: 400 });
    }
    const artifactBytes = new Uint8Array(await artifactFile.arrayBuffer());
    const artifactSha256 = await sha256Hex(artifactBytes);
    if (artifact.sha256 !== artifactSha256) {
      return Response.json({ error: 'Artifact SHA-256 does not match the signed receipt.' }, { status: 400 });
    }
    const mediaType = artifactFile.type || 'application/octet-stream';
    if (artifact.type !== mediaType) return Response.json({ error: 'Artifact media type does not match the signed receipt.' }, { status: 400 });
    if (receipt.evidence?.acceptance_sha256) {
      return Response.json({ error: 'Initial results cannot claim issuer acceptance.' }, { status: 400 });
    }
    try {
      validateGitHubEvidence(receipt.evidence);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Malformed GitHub evidence.' }, { status: 400 });
    }

    const safeName = artifactFile.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'artifact.bin';
    const artifactObjectKey = `artifacts/${resultId}/${safeName}`;
    await putImmutableObject({
      objectKey: artifactObjectKey,
      bytes: artifactBytes,
      contentType: mediaType,
      customMetadata: { resultId, actorDid: claimantDid },
    });
    const receiptSha256 = await sha256Hex(canonicalJson(receipt));
    await persistReceipt({
      id: resultId,
      schema: 'technocore-task-receipt:1',
      actorDid: claimantDid,
      missionId: mission.id,
      createdAt: receipt.created_at,
      payload: receipt,
    });
    await createResult({
      id: resultId,
      missionId: mission.id,
      claimId,
      actorDid: claimantDid,
      receiptJson: canonicalJson(receipt),
      receiptSha256,
      artifactObjectKey,
      artifactName: safeName,
      artifactMediaType: mediaType,
      artifactSha256,
      artifactBytes: artifactFile.size,
      repositoryUrl: receipt.evidence?.repository ?? null,
      commitSha: receipt.evidence?.commit ?? null,
      createdAt: receipt.created_at,
    });

    return Response.json({
      id: resultId,
      receipt,
      sha256: `sha256:${receiptSha256}`,
      portableUrl: `/receipt/${resultId}`,
      rawUrl: `/api/receipts/${resultId}`,
      artifactUrl: `/api/artifacts/${resultId}`,
      proof: {
        cryptographic: 'valid',
        artifacts: 'match',
        github: receipt.evidence ? 'not-checked' : 'absent',
        ci: 'absent',
        issuerAcceptance: 'absent',
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'This claim already has a result.' }, { status: 409 });
    return Response.json({ error: 'Result could not be recorded.' }, { status: 503 });
  }
}
