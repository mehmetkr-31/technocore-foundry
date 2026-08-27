import { createAcceptance, findMission, findResult } from '@/db/queries';
import {
  canonicalJson,
  EVENT_SCHEMA,
  type FoundryAcceptanceEvent,
  sha256Hex,
  type SignedFoundryEvent,
  verifySignedEvent,
} from '@/lib/foundry-crypto';
import { persistReceipt } from '@/lib/server-receipts';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function looksLikeAcceptance(value: unknown): value is SignedFoundryEvent<FoundryAcceptanceEvent> {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<SignedFoundryEvent<FoundryAcceptanceEvent>>;
  const event = receipt.event;
  return Boolean(
    event && event.schema === EVENT_SCHEMA && event.type === 'acceptance' &&
    /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
    /^res_[a-f0-9]{24}$/.test(event.resultId) &&
    /^sha256:[a-f0-9]{64}$/.test(event.resultSha256) &&
    (event.decision === 'accepted' || event.decision === 'rejected') &&
    typeof event.note === 'string' && event.note.length <= 500 &&
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
    if (raw.byteLength > 16_384) throw new Error('oversized');
    payload = parseStrictJsonBytes(raw);
  } catch {
    return Response.json({ error: 'Expected a small signed acceptance JSON document.' }, { status: 400 });
  }
  if (!looksLikeAcceptance(payload)) return Response.json({ error: 'Malformed acceptance event.' }, { status: 400 });
  if (Math.abs(Date.now() - Date.parse(payload.event.createdAt)) > 10 * 60 * 1000) {
    return Response.json({ error: 'Acceptance timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifySignedEvent(payload))) return Response.json({ error: 'Issuer signature is invalid.' }, { status: 400 });
    const [mission, result] = await Promise.all([
      findMission(payload.event.missionId),
      findResult(payload.event.resultId),
    ]);
    if (!mission || !result || result.missionId !== mission.id) return Response.json({ error: 'Mission result not found.' }, { status: 404 });
    if (payload.event.actor !== mission.issuerDid) return Response.json({ error: 'Only the mission issuer can sign acceptance.' }, { status: 403 });
    if (payload.event.resultSha256 !== `sha256:${result.receiptSha256}`) {
      return Response.json({ error: 'Acceptance does not bind the stored result receipt.' }, { status: 409 });
    }
    const receiptSha256 = await sha256Hex(canonicalJson(payload));
    const id = `fac_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id,
      schema: EVENT_SCHEMA,
      actorDid: payload.event.actor,
      missionId: payload.event.missionId,
      createdAt: payload.event.createdAt,
      payload,
    });
    await createAcceptance({
      id,
      resultId: payload.event.resultId,
      missionId: payload.event.missionId,
      issuerDid: payload.event.actor,
      decision: payload.event.decision,
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
      decision: payload.event.decision,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'This result already has an issuer decision.' }, { status: 409 });
    return Response.json({ error: 'Issuer decision could not be recorded.' }, { status: 503 });
  }
}
