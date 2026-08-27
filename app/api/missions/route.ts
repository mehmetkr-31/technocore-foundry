import { createMission, listMissions } from '@/db/queries';
import {
  canonicalJson,
  EVENT_SCHEMA,
  type FoundryMissionEvent,
  sha256Hex,
  type SignedFoundryEvent,
  verifySignedEvent,
} from '@/lib/foundry-crypto';
import { persistReceipt } from '@/lib/server-receipts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(
      { missions: await listMissions() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Mission ledger is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function looksLikeMission(value: unknown): value is SignedFoundryEvent<FoundryMissionEvent> {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<SignedFoundryEvent<FoundryMissionEvent>>;
  const event = receipt.event;
  return Boolean(
    event &&
      event.schema === EVENT_SCHEMA &&
      event.type === 'mission' &&
      /^F-[A-F0-9]{8}$/.test(event.missionId) &&
      typeof event.title === 'string' && event.title.length >= 8 && event.title.length <= 100 &&
      typeof event.lane === 'string' && event.lane.length >= 3 && event.lane.length <= 40 &&
      typeof event.summary === 'string' && event.summary.length >= 20 && event.summary.length <= 300 &&
      typeof event.requirements === 'string' && event.requirements.length >= 20 && event.requirements.length <= 4000 &&
      /^sha256:[a-f0-9]{64}$/.test(event.requirementsHash) &&
      typeof event.actor === 'string' && event.actor.length <= 160 &&
      typeof event.nonce === 'string' && event.nonce.length <= 80 &&
      typeof event.createdAt === 'string' &&
      typeof receipt.signature === 'string' && receipt.signature.length <= 512,
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) throw new Error('oversized');
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Expected a small signed mission JSON document.' }, { status: 400 });
  }
  if (!looksLikeMission(payload)) return Response.json({ error: 'Malformed mission event.' }, { status: 400 });

  const createdAt = Date.parse(payload.event.createdAt);
  if (!Number.isFinite(createdAt) || Math.abs(Date.now() - createdAt) > 10 * 60 * 1000) {
    return Response.json({ error: 'Mission timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifySignedEvent(payload))) return Response.json({ error: 'The issuer signature is invalid.' }, { status: 400 });
    const expectedHash = `sha256:${await sha256Hex(payload.event.requirements)}`;
    if (expectedHash !== payload.event.requirementsHash) {
      return Response.json({ error: 'Requirements hash does not match the signed requirements.' }, { status: 400 });
    }
    const receiptSha256 = await sha256Hex(canonicalJson(payload));
    const receiptId = `fms_${receiptSha256.slice(0, 24)}`;
    await persistReceipt({
      id: receiptId,
      schema: EVENT_SCHEMA,
      actorDid: payload.event.actor,
      missionId: payload.event.missionId,
      createdAt: payload.event.createdAt,
      payload,
    });
    await createMission({
      id: payload.event.missionId,
      title: payload.event.title,
      lane: payload.event.lane.toUpperCase(),
      summary: payload.event.summary,
      requirementsHash: payload.event.requirementsHash,
      issuerDid: payload.event.actor,
      createdAt: payload.event.createdAt,
      receiptId,
      eventJson: canonicalJson(payload.event),
      signature: payload.signature,
    });
    return Response.json({
      mission: {
        id: payload.event.missionId,
        title: payload.event.title,
        lane: payload.event.lane.toUpperCase(),
        summary: payload.event.summary,
        requirementsHash: payload.event.requirementsHash,
        issuerDid: payload.event.actor,
        status: 'open',
        createdAt: payload.event.createdAt,
        claimCount: 0,
        resultCount: 0,
        acceptedCount: 0,
      },
      receiptId,
      portableUrl: `/receipt/${receiptId}`,
      rawUrl: `/api/receipts/${receiptId}`,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) return Response.json({ error: 'Mission already exists.' }, { status: 409 });
    return Response.json({ error: 'Mission could not be published.' }, { status: 503 });
  }
}
