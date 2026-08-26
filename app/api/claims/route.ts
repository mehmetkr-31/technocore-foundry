import { env } from 'cloudflare:workers';
import { createClaim, createReceipt, findMission } from '@/db/queries';
import {
  canonicalJson,
  EVENT_SCHEMA,
  type SignedFoundryEvent,
  verifySignedEvent,
} from '@/lib/foundry-crypto';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;

function looksLikeClaim(value: unknown): value is SignedFoundryEvent {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<SignedFoundryEvent>;
  const event = receipt.event;
  return Boolean(
    event &&
      event.schema === EVENT_SCHEMA &&
      event.type === 'claim' &&
      typeof event.missionId === 'string' &&
      /^M-[0-9]{3}$/.test(event.missionId) &&
      typeof event.requirementsHash === 'string' &&
      /^sha256:[a-f0-9]{64}$/.test(event.requirementsHash) &&
      typeof event.actor === 'string' &&
      event.actor.length <= 160 &&
      typeof event.nonce === 'string' &&
      event.nonce.length <= 80 &&
      typeof event.createdAt === 'string' &&
      typeof receipt.signature === 'string' &&
      receipt.signature.length <= 512,
  );
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Receipt exceeds the 16 KB limit.' }, { status: 413 });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error('oversized');
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Expected a small JSON signed claim.' }, { status: 400 });
  }

  if (!looksLikeClaim(payload)) {
    return Response.json({ error: 'Malformed Foundry claim.' }, { status: 400 });
  }

  const createdAt = Date.parse(payload.event.createdAt);
  if (!Number.isFinite(createdAt) || Math.abs(Date.now() - createdAt) > 10 * 60 * 1000) {
    return Response.json({ error: 'Claim timestamp is outside the 10 minute window.' }, { status: 400 });
  }

  try {
    if (!(await verifySignedEvent(payload))) {
      return Response.json({ error: 'The DID signature is invalid.' }, { status: 400 });
    }

    const mission = await findMission(payload.event.missionId);
    if (!mission || mission.status !== 'open') {
      return Response.json({ error: 'Mission is missing or closed.' }, { status: 404 });
    }
    if (mission.requirementsHash !== payload.event.requirementsHash) {
      return Response.json({ error: 'Mission requirements changed; refresh before claiming.' }, { status: 409 });
    }

    const receiptJson = `${canonicalJson(payload)}\n`;
    const receiptBytes = new TextEncoder().encode(receiptJson);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', receiptBytes));
    const sha256 = hex(digest);
    const id = `frc_${sha256.slice(0, 24)}`;
    const objectKey = `receipts/${id}.json`;

    if (!env.FILES) throw new Error('R2 binding unavailable');
    await env.FILES.put(objectKey, receiptBytes, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        actorDid: payload.event.actor,
        missionId: payload.event.missionId,
        sha256,
      },
    });
    await createClaim({
      id,
      missionId: payload.event.missionId,
      actorDid: payload.event.actor,
      signature: payload.signature,
      eventJson: canonicalJson(payload.event),
      createdAt: payload.event.createdAt,
    });
    await createReceipt({
      id,
      actorDid: payload.event.actor,
      missionId: payload.event.missionId,
      objectKey,
      sha256,
      bytes: receiptBytes.byteLength,
      createdAt: payload.event.createdAt,
    });

    return Response.json(
      {
        id,
        receipt: payload,
        sha256: `sha256:${sha256}`,
        portableUrl: `/api/receipts/${id}`,
        proof: {
          keyControl: 'valid',
          requirementsHash: 'match',
          issuerAcceptance: 'not-present',
          technocoreObservation: 'not-checked',
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|constraint/i.test(message)) {
      return Response.json({ error: 'This DID already claimed the mission.' }, { status: 409 });
    }
    return Response.json({ error: 'The claim could not be recorded.' }, { status: 503 });
  }
}
