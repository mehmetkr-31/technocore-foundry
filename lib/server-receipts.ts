import { env } from 'cloudflare:workers';
import { createReceipt } from '@/db/queries';
import { canonicalJson, sha256Hex } from './foundry-crypto';

export async function putImmutableObject(input: {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  customMetadata: Record<string, string>;
}) {
  if (!env.FILES) throw new Error('R2 binding unavailable');
  const sha256 = await sha256Hex(input.bytes);
  const created = await env.FILES.put(input.objectKey, input.bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: input.contentType },
    customMetadata: { ...input.customMetadata, sha256 },
  });
  if (!created) {
    const existing = await env.FILES.get(input.objectKey);
    if (!existing) throw new Error('Immutable object creation raced; retry after inspecting storage state.');
    const existingBytes = new Uint8Array(await existing.arrayBuffer());
    const existingSha256 = await sha256Hex(existingBytes);
    if (existingBytes.byteLength !== input.bytes.byteLength || existingSha256 !== sha256) {
      throw new Error('Immutable object collision: refusing to overwrite stored bytes.');
    }
  }
  return { sha256 };
}

export async function persistReceipt(input: {
  id: string;
  schema: string;
  actorDid: string;
  missionId: string;
  createdAt: string;
  payload: unknown;
}) {
  const receiptJson = `${canonicalJson(input.payload)}\n`;
  const receiptBytes = new TextEncoder().encode(receiptJson);
  const objectKey = `receipts/${input.id}.json`;
  const { sha256 } = await putImmutableObject({
    objectKey,
    bytes: receiptBytes,
    contentType: 'application/json',
    customMetadata: {
      actorDid: input.actorDid,
      missionId: input.missionId,
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
