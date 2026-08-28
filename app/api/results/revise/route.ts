import {
  createRevision,
  findChangeRequest,
  findClaimById,
  findLatestResultForClaim,
  findMission,
  findResult,
} from '@/db/queries';
import {
  canonicalJson,
  EVENT_SCHEMA,
  type FoundryRevisionEvent,
  MAX_RESULT_REVISIONS,
  sha256Hex,
  type SignedFoundryEvent,
  tcr1ClaimantDid,
  type Tcr1Receipt,
  verifySignedEvent,
  verifyTcr1Receipt,
} from '@/lib/foundry-crypto';
import { validateGitHubEvidence } from '@/lib/github-evidence';
import { persistReceipt, putImmutableObject } from '@/lib/server-receipts';
import { parseStrictJson } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_ARTIFACT_BYTES + 96 * 1024) {
    return Response.json({ error: 'Artifact exceeds the 5 MB preview limit.' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected a multipart revision submission.' }, { status: 400 });
  }

  const resultId = String(form.get('resultId') ?? '');
  const receiptRaw = String(form.get('receipt') ?? '');
  const revisionRaw = String(form.get('revisionEvent') ?? '');
  const artifactFile = form.get('artifact');
  if (!/^res_[a-f0-9]{24}$/.test(resultId)) {
    return Response.json({ error: 'Malformed revision result identifier.' }, { status: 400 });
  }
  if (!(artifactFile instanceof File) || artifactFile.size < 1 || artifactFile.size > MAX_ARTIFACT_BYTES) {
    return Response.json({ error: 'Choose one non-empty artifact up to 5 MB.' }, { status: 400 });
  }

  let receipt: Tcr1Receipt;
  let revisionReceipt: SignedFoundryEvent<FoundryRevisionEvent>;
  try {
    receipt = parseStrictJson(receiptRaw) as Tcr1Receipt;
    revisionReceipt = parseStrictJson(revisionRaw) as SignedFoundryEvent<FoundryRevisionEvent>;
  } catch {
    return Response.json({ error: 'Malformed TCR-1 or revision-event JSON.' }, { status: 400 });
  }
  if (revisionReceipt?.event?.type !== 'revision' || revisionReceipt.event.resultId !== resultId) {
    return Response.json({ error: 'Revision event does not identify this result.' }, { status: 400 });
  }

  try {
    if (await findResult(resultId)) {
      return Response.json({ error: 'Result identifier is already immutable.' }, { status: 409 });
    }
    if (!(await verifyTcr1Receipt(receipt))) {
      return Response.json({ error: 'Revision TCR-1 schema or claimant signature is invalid.' }, { status: 400 });
    }
    if (!(await verifySignedEvent(revisionReceipt))) {
      return Response.json({ error: 'Revision-chain signature is invalid.' }, { status: 400 });
    }
    const claimantDid = tcr1ClaimantDid(receipt);
    if (!claimantDid || revisionReceipt.event.actor !== claimantDid) {
      return Response.json({ error: 'Revision and TCR-1 must be signed by the same claimant DID.' }, { status: 403 });
    }
    if (
      Math.abs(Date.now() - Date.parse(receipt.created_at)) > 10 * 60 * 1000 ||
      Math.abs(Date.now() - Date.parse(revisionReceipt.event.createdAt)) > 10 * 60 * 1000
    ) return Response.json({ error: 'Revision timestamp is outside the 10 minute window.' }, { status: 400 });

    const [mission, claim, parent, changeRequest] = await Promise.all([
      findMission(revisionReceipt.event.missionId),
      findClaimById(revisionReceipt.event.claimId),
      findResult(revisionReceipt.event.parentResultId),
      findChangeRequest(revisionReceipt.event.parentResultId),
    ]);
    if (!mission || !claim || !parent || !changeRequest) {
      return Response.json({ error: 'Revision parent, claim, mission, or change request is missing.' }, { status: 404 });
    }
    if (
      claim.id !== parent.claimId || claim.actorDid !== claimantDid ||
      claim.missionId !== mission.id || parent.missionId !== mission.id
    ) return Response.json({ error: 'Revision claimant does not own the parent claim chain.' }, { status: 403 });
    if (parent.acceptanceId || parent.finalReceiptId) {
      return Response.json({ error: 'An accepted or finalized result cannot be revised.' }, { status: 409 });
    }
    if (parent.revision >= MAX_RESULT_REVISIONS) {
      return Response.json({ error: `The ${MAX_RESULT_REVISIONS}-revision limit has been reached.` }, { status: 409 });
    }
    const latest = await findLatestResultForClaim(parent.claimId);
    if (!latest || latest.id !== parent.id) {
      return Response.json({ error: 'Revision parent is stale; only the latest result may be revised.' }, { status: 409 });
    }

    const original = parseStrictJson(parent.receiptJson) as Tcr1Receipt;
    if (
      canonicalJson(receipt.task) !== canonicalJson(original.task) ||
      receipt.task.id !== mission.id || receipt.task.issuer !== mission.issuerDid ||
      receipt.task.requirements_sha256 !== mission.requirementsHash.slice('sha256:'.length)
    ) return Response.json({ error: 'Revision TCR-1 must preserve the original signed task binding.' }, { status: 409 });
    if (receipt.evidence?.acceptance_sha256) {
      return Response.json({ error: 'A revision cannot claim issuer acceptance before review.' }, { status: 400 });
    }
    try {
      validateGitHubEvidence(receipt.evidence);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Malformed GitHub evidence.' }, { status: 400 });
    }

    const artifact = receipt.artifacts[0];
    const expectedUri = new URL(`/api/artifacts/${resultId}`, request.url).toString();
    if (receipt.artifacts.length !== 1 || artifact.uri !== expectedUri || artifact.size !== artifactFile.size) {
      return Response.json({ error: 'Artifact URI or declared size does not match the revision upload.' }, { status: 400 });
    }
    const artifactBytes = new Uint8Array(await artifactFile.arrayBuffer());
    const artifactSha256 = await sha256Hex(artifactBytes);
    const mediaType = artifactFile.type || 'application/octet-stream';
    if (artifact.sha256 !== artifactSha256 || artifact.type !== mediaType) {
      return Response.json({ error: 'Revision artifact digest or media type does not match the signed TCR-1.' }, { status: 400 });
    }

    const receiptJson = canonicalJson(receipt);
    const receiptSha256 = await sha256Hex(receiptJson);
    const chain = revisionReceipt.event;
    if (
      chain.resultSha256 !== `sha256:${receiptSha256}` ||
      chain.parentResultSha256 !== `sha256:${parent.receiptSha256}` ||
      changeRequest.resultSha256 !== parent.receiptSha256 ||
      chain.changeRequestId !== changeRequest.id ||
      chain.changeRequestSha256 !== `sha256:${changeRequest.receiptSha256}` ||
      chain.revision !== parent.revision + 1
    ) return Response.json({ error: 'Revision chain does not bind the exact parent and change-request receipts.' }, { status: 409 });

    const safeName = artifactFile.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'artifact.bin';
    const artifactObjectKey = `artifacts/${resultId}/${safeName}`;
    await putImmutableObject({
      objectKey: artifactObjectKey,
      bytes: artifactBytes,
      contentType: mediaType,
      customMetadata: { resultId, actorDid: claimantDid, revision: String(chain.revision) },
    });
    await persistReceipt({
      id: resultId,
      schema: `technocore-task-receipt:1:revision-${chain.revision}`,
      actorDid: claimantDid,
      missionId: mission.id,
      createdAt: receipt.created_at,
      payload: receipt,
    });
    const revisionReceiptJson = canonicalJson(revisionReceipt);
    const revisionReceiptSha256 = await sha256Hex(revisionReceiptJson);
    const revisionReceiptId = `frv_${revisionReceiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id: revisionReceiptId,
      schema: `${EVENT_SCHEMA}:revision`,
      actorDid: claimantDid,
      missionId: mission.id,
      createdAt: chain.createdAt,
      payload: revisionReceipt,
    });
    await createRevision({
      id: resultId,
      missionId: mission.id,
      claimId: claim.id,
      actorDid: claimantDid,
      revision: chain.revision,
      parentResultId: parent.id,
      parentReceiptSha256: parent.receiptSha256,
      changeRequestId: changeRequest.id,
      changeRequestSha256: changeRequest.receiptSha256,
      revisionReceiptId,
      revisionEventJson: canonicalJson(chain),
      revisionSignature: revisionReceipt.signature,
      receiptJson,
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
      revision: chain.revision,
      receipt,
      sha256: `sha256:${receiptSha256}`,
      portableUrl: `/receipt/${resultId}`,
      rawUrl: `/api/receipts/${resultId}`,
      artifactUrl: `/api/artifacts/${resultId}`,
      revisionReceipt: {
        id: revisionReceiptId,
        receipt: revisionReceipt,
        sha256: `sha256:${revisionReceiptSha256}`,
        portableUrl: `/receipt/${revisionReceiptId}`,
        rawUrl: `/api/receipts/${revisionReceiptId}`,
      },
      chain: {
        parentResultId: parent.id,
        changeRequestId: changeRequest.id,
        maxRevisions: MAX_RESULT_REVISIONS,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) {
      return Response.json({ error: 'This change request already has an immutable revision.' }, { status: 409 });
    }
    return Response.json({ error: 'Revision could not be recorded.' }, { status: 503 });
  }
}
