import { createAttestation, findMission, findResult } from '@/db/queries';
import {
  ATTESTATION_STATEMENTS,
  canonicalJson,
  EVENT_SCHEMA,
  type FoundryAttestationEvent,
  sha256Hex,
  type SignedFoundryEvent,
  verifySignedEvent,
} from '@/lib/foundry-crypto';
import { persistReceipt } from '@/lib/server-receipts';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function looksLikeAttestation(value: unknown): value is SignedFoundryEvent<FoundryAttestationEvent> {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<SignedFoundryEvent<FoundryAttestationEvent>>;
  const event = receipt.event;
  return Boolean(
    event && event.schema === EVENT_SCHEMA && event.type === 'attestation' &&
    /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
    /^res_[a-f0-9]{24}$/.test(event.resultId) &&
    /^sha256:[a-f0-9]{64}$/.test(event.resultSha256) &&
    ATTESTATION_STATEMENTS.includes(event.statement) &&
    typeof event.note === 'string' && event.note.length >= 12 && event.note.length <= 500 &&
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
    return Response.json({ error: 'Expected a small signed attestation JSON document.' }, { status: 400 });
  }
  if (!looksLikeAttestation(payload)) return Response.json({ error: 'Malformed attestation event.' }, { status: 400 });
  if (Math.abs(Date.now() - Date.parse(payload.event.createdAt)) > 10 * 60 * 1000) {
    return Response.json({ error: 'Attestation timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifySignedEvent(payload))) return Response.json({ error: 'Peer signature is invalid.' }, { status: 400 });
    const [mission, result] = await Promise.all([
      findMission(payload.event.missionId),
      findResult(payload.event.resultId),
    ]);
    if (!mission || !result || result.missionId !== mission.id) return Response.json({ error: 'Mission result not found.' }, { status: 404 });
    if (result.acceptanceDecision !== 'accepted') return Response.json({ error: 'Only an issuer-accepted result can receive peer attestations.' }, { status: 409 });
    if (payload.event.actor === result.actorDid || payload.event.actor === mission.issuerDid) {
      return Response.json({ error: 'Claimant and issuer cannot act as independent peers for this result.' }, { status: 403 });
    }
    if (payload.event.resultSha256 !== `sha256:${result.receiptSha256}`) {
      return Response.json({ error: 'Attestation does not bind the stored immutable result.' }, { status: 409 });
    }

    const receiptSha256 = await sha256Hex(canonicalJson(payload));
    const id = `fat_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id,
      schema: `${EVENT_SCHEMA}:attestation`,
      actorDid: payload.event.actor,
      missionId: payload.event.missionId,
      createdAt: payload.event.createdAt,
      payload,
    });
    await createAttestation({
      id,
      resultId: payload.event.resultId,
      missionId: payload.event.missionId,
      actorDid: payload.event.actor,
      statement: payload.event.statement,
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
      layer: 'peer_attestation',
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'This peer already recorded that statement for this result.' }, { status: 409 });
    return Response.json({ error: 'Peer attestation could not be recorded.' }, { status: 503 });
  }
}
