import {
  createChangeRequest,
  findLatestResultForClaim,
  findMission,
  findResult,
} from '@/db/queries';
import {
  canonicalJson,
  EVENT_SCHEMA,
  type FoundryChangeRequestEvent,
  MAX_RESULT_REVISIONS,
  sha256Hex,
  type SignedFoundryEvent,
  verifySignedEvent,
} from '@/lib/foundry-crypto';
import { persistReceipt } from '@/lib/server-receipts';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function looksLikeChangeRequest(value: unknown): value is SignedFoundryEvent<FoundryChangeRequestEvent> {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<SignedFoundryEvent<FoundryChangeRequestEvent>>;
  const event = receipt.event;
  return Boolean(
    event && event.schema === EVENT_SCHEMA && event.type === 'change_request' &&
    /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
    /^res_[a-f0-9]{24}$/.test(event.resultId) &&
    /^sha256:[a-f0-9]{64}$/.test(event.resultSha256) &&
    typeof event.note === 'string' && event.note.length >= 12 && event.note.length <= 1000 &&
    typeof event.actor === 'string' && event.actor.length <= 160 &&
    typeof event.nonce === 'string' && event.nonce.length <= 80 &&
    typeof event.createdAt === 'string' &&
    typeof receipt.signature === 'string' && receipt.signature.length <= 512,
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 24_576) throw new Error('oversized');
    payload = parseStrictJsonBytes(raw);
  } catch {
    return Response.json({ error: 'Expected a small signed change-request JSON document.' }, { status: 400 });
  }
  if (!looksLikeChangeRequest(payload)) return Response.json({ error: 'Malformed change-request event.' }, { status: 400 });
  if (Math.abs(Date.now() - Date.parse(payload.event.createdAt)) > 10 * 60 * 1000) {
    return Response.json({ error: 'Change-request timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifySignedEvent(payload))) return Response.json({ error: 'Issuer signature is invalid.' }, { status: 400 });
    const [mission, result] = await Promise.all([
      findMission(payload.event.missionId),
      findResult(payload.event.resultId),
    ]);
    if (!mission || !result || result.missionId !== mission.id) {
      return Response.json({ error: 'Mission result not found.' }, { status: 404 });
    }
    if (payload.event.actor !== mission.issuerDid) {
      return Response.json({ error: 'Only the mission issuer can request changes.' }, { status: 403 });
    }
    if (payload.event.resultSha256 !== `sha256:${result.receiptSha256}`) {
      return Response.json({ error: 'Change request does not bind the stored result receipt.' }, { status: 409 });
    }
    if (result.acceptanceId || result.changeRequestId || result.finalReceiptId) {
      return Response.json({ error: 'This immutable revision already has an issuer decision.' }, { status: 409 });
    }
    if (result.revision >= MAX_RESULT_REVISIONS) {
      return Response.json({ error: `The ${MAX_RESULT_REVISIONS}-revision limit has been reached.` }, { status: 409 });
    }
    const latest = await findLatestResultForClaim(result.claimId);
    if (!latest || latest.id !== result.id) {
      return Response.json({ error: 'Only the latest immutable revision can receive a change request.' }, { status: 409 });
    }

    const receiptSha256 = await sha256Hex(canonicalJson(payload));
    const id = `fcr_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id,
      schema: `${EVENT_SCHEMA}:change-request`,
      actorDid: payload.event.actor,
      missionId: payload.event.missionId,
      createdAt: payload.event.createdAt,
      payload,
    });
    await createChangeRequest({
      id,
      resultId: payload.event.resultId,
      missionId: payload.event.missionId,
      issuerDid: payload.event.actor,
      resultSha256: payload.event.resultSha256.slice('sha256:'.length),
      note: payload.event.note,
      eventJson: canonicalJson(payload.event),
      signature: payload.signature,
      receiptSha256,
      createdAt: payload.event.createdAt,
    });
    return Response.json({
      id,
      receipt: payload,
      sha256: `sha256:${receiptSha256}`,
      portableUrl: `/receipt/${id}`,
      rawUrl: `/api/receipts/${id}`,
      decision: 'changes_requested',
      nextRevision: result.revision + 1,
      maxRevisions: MAX_RESULT_REVISIONS,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) {
      return Response.json({ error: 'This immutable revision already has a change request.' }, { status: 409 });
    }
    return Response.json({ error: 'Change request could not be recorded.' }, { status: 503 });
  }
}
