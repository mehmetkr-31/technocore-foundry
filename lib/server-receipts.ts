import { env } from 'cloudflare:workers';
import { createReceipt } from '@/db/queries';
import { canonicalJson, sha256Hex } from './foundry-crypto';

export async function persistReceipt(input: {
  id: string;
  schema: string;
  actorDid: string;
  missionId: string;
  createdAt: string;
  payload: unknown;
}) {
  if (!env.FILES) throw new Error('R2 binding unavailable');
  const receiptJson = `${canonicalJson(input.payload)}\n`;
  const receiptBytes = new TextEncoder().encode(receiptJson);
  const sha256 = await sha256Hex(receiptBytes);
  const objectKey = `receipts/${input.id}.json`;

  await env.FILES.put(objectKey, receiptBytes, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      actorDid: input.actorDid,
      missionId: input.missionId,
      sha256,
      schema: input.schema,
    },
  });
  await createReceipt({
    id: input.id,
    schema: input.schema,
    actorDid: input.actorDid,
    missionId: input.missionId,
    objectKey,
    sha256,
    bytes: receiptBytes.byteLength,
    createdAt: input.createdAt,
  });
  return { receiptJson, receiptBytes, sha256, objectKey };
}
