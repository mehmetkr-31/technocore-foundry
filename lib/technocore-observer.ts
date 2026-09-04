import type { ObserverEpochRecord, ObserverGapRecord, TransportObservationRecord } from '@/db/queries';
import { sha256Hex, sweepTechnocoreText, verifyTechnocoreMessage } from './foundry-crypto';
import {
  TECHNOCORE_NONCE_PATTERN,
  TECHNOCORE_OPERATIONAL_COMMIT,
  TECHNOCORE_ORIGIN,
  TECHNOCORE_SIGNATURE_PATTERN,
} from './technocore-contract';

export { TECHNOCORE_ORIGIN };
export const FOUNDRY_ROOM = 'foundry-contributions' as const;
export const TECHNOCORE_SOURCE_COMMIT = TECHNOCORE_OPERATIONAL_COMMIT;
const RECEIPT_PATTERN = /\b(?:frc|fms|res|fac|fcr|frv|fat|tcf|fev|frw)_[a-f0-9]{24}\b/;

export type TechnocoreRoomMessage = {
  seq: number;
  ts: string;
  from: string;
  text: string;
  nonce?: string;
  sig?: string;
};

export type TechnocoreRoomView = {
  room: string;
  count: number;
  first_seq: number | null;
  last_seq: number;
  generation: number;
  messages: TechnocoreRoomMessage[];
};

function integerString(value: unknown, label: string) {
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error(`Technocore ${label} is invalid.`);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`Technocore ${label} was rounded.`);
  const integer = BigInt(value);
  if (integer < 0n) throw new Error(`Technocore ${label} is invalid.`);
  return integer.toString();
}

export function parseRoomView(value: unknown): TechnocoreRoomView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Technocore returned a malformed room view.');
  const view = value as Record<string, unknown>;
  if (
    view.room !== FOUNDRY_ROOM || !Number.isSafeInteger(view.count) || Number(view.count) < 0 ||
    !Number.isSafeInteger(view.last_seq) || Number(view.last_seq) < 0 ||
    !Number.isSafeInteger(view.generation) || Number(view.generation) < 0 || !Array.isArray(view.messages)
  ) throw new Error('Technocore returned an unexpected room envelope.');
  if (view.first_seq !== null && (!Number.isSafeInteger(view.first_seq) || Number(view.first_seq) < 1)) throw new Error('Technocore returned an invalid first_seq.');
  if (view.messages.length > 200) throw new Error('Technocore returned too many messages.');
  let prior = 0;
  const messages = view.messages.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Technocore returned a malformed message.');
    const message = item as Record<string, unknown>;
    const allowed = new Set(['seq', 'ts', 'from', 'text', 'nonce', 'sig']);
    if (Object.keys(message).some((key) => !allowed.has(key))) throw new Error('Technocore message has unsupported fields.');
    if (!Number.isSafeInteger(message.seq) || Number(message.seq) < 1 || Number(message.seq) <= prior) throw new Error('Technocore message sequence is invalid.');
    if (typeof message.ts !== 'string' || message.ts.length > 64 || !Number.isFinite(Date.parse(message.ts))) throw new Error('Technocore message timestamp is invalid.');
    if (typeof message.from !== 'string' || message.from.length < 1 || message.from.length > 160) throw new Error('Technocore message actor is invalid.');
    if (typeof message.text !== 'string') throw new Error('Technocore message text is invalid.');
    try {
      if (sweepTechnocoreText(message.text) !== message.text) throw new Error('not in stored form');
    } catch {
      throw new Error('Technocore message text is invalid.');
    }
    const nonce = Object.hasOwn(message, 'nonce') ? integerString(message.nonce, 'message nonce') : undefined;
    const sig = Object.hasOwn(message, 'sig') && typeof message.sig === 'string' ? message.sig : undefined;
    prior = Number(message.seq);
    return { seq: prior, ts: message.ts, from: message.from, text: message.text, nonce, sig };
  });
  if (messages.length !== Number(view.count) || (messages[0]?.seq ?? null) !== view.first_seq || (messages.at(-1)?.seq ?? Number(view.last_seq)) !== Number(view.last_seq)) {
    throw new Error('Technocore room counters do not match the returned messages.');
  }
  return {
    room: FOUNDRY_ROOM,
    count: Number(view.count),
    first_seq: view.first_seq as number | null,
    last_seq: Number(view.last_seq),
    generation: Number(view.generation),
    messages,
  };
}

function actorHint(value: string) {
  return /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(value) ? value : 'unsigned-or-self-asserted';
}

async function signatureState(message: TechnocoreRoomMessage): Promise<TransportObservationRecord['verificationState']> {
  if (message.nonce === undefined && message.sig === undefined) return 'unsigned';
  if (message.from.startsWith('did:key:') && message.nonce !== undefined && message.sig === undefined) return 'not_reverifiable';
  if (
    message.nonce === undefined || !TECHNOCORE_NONCE_PATTERN.test(message.nonce) ||
    message.sig === undefined || !TECHNOCORE_SIGNATURE_PATTERN.test(message.sig)
  ) return 'invalid';
  return await verifyTechnocoreMessage({
    room: FOUNDRY_ROOM,
    did: message.from,
    nonce: message.nonce,
    sig: message.sig,
    text: message.text,
  }) ? 'valid' : 'invalid';
}

function encodedGeneration(id: string) {
  const match = /:g(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

export async function planObserverSync(input: {
  current: ObserverEpochRecord | null;
  tailSeq: number;
  tailGeneration: number;
  view: TechnocoreRoomView;
  syncedAt: string;
}) {
  if (input.tailGeneration !== input.view.generation) throw new Error('Technocore room generation changed during the bounded read.');
  const priorGeneration = input.current ? encodedGeneration(input.current.id) : null;
  const generationChanged = Boolean(input.current && priorGeneration !== input.view.generation);
  const sequenceRewound = Boolean(input.current && input.tailSeq < input.current.endSeq);
  const newEpoch = generationChanged || sequenceRewound;
  const epoch = input.current ? input.current.epoch + (newEpoch ? 1 : 0) : 0;
  const cursor = input.current && !newEpoch ? input.current.endSeq : 0;
  const firstReturned = input.view.first_seq ?? cursor;
  const gap = !newEpoch && input.view.first_seq !== null && input.view.first_seq > cursor + 1
    ? {
        id: `${FOUNDRY_ROOM}:${epoch}:retention:${cursor + 1}:${input.view.first_seq}`,
        room: FOUNDRY_ROOM,
        epoch,
        kind: 'retention_gap' as const,
        expectedSeq: cursor + 1,
        firstSeq: input.view.first_seq,
        detectedAt: input.syncedAt,
      }
    : null;
  const epochRewind: ObserverGapRecord | null = newEpoch && input.current
    ? {
        id: `${FOUNDRY_ROOM}:${epoch}:${generationChanged ? 'generation' : 'rewind'}:${input.current.endSeq + 1}:${input.tailSeq}`,
        room: FOUNDRY_ROOM,
        epoch,
        kind: generationChanged ? 'generation_change' : 'epoch_rewind',
        expectedSeq: input.current.endSeq + 1,
        firstSeq: input.view.first_seq ?? 0,
        detectedAt: input.syncedAt,
      }
    : null;
  const observations: TransportObservationRecord[] = await Promise.all(input.view.messages.map(async (message) => ({
    id: `${FOUNDRY_ROOM}:${epoch}:${message.seq}`,
    room: FOUNDRY_ROOM,
    epoch,
    sequence: message.seq,
    serverTimestamp: message.ts,
    actorHint: actorHint(message.from),
    textSha256: `sha256:${await sha256Hex(message.text)}`,
    receiptId: message.text.match(RECEIPT_PATTERN)?.[0] ?? null,
    verificationState: await signatureState(message),
    observedAt: input.syncedAt,
  })));
  return {
    room: FOUNDRY_ROOM,
    epoch,
    epochId: `${FOUNDRY_ROOM}:${epoch}:g${input.view.generation}`,
    upstreamGeneration: input.view.generation,
    priorEpoch: input.current?.epoch ?? null,
    startSeq: firstReturned,
    endSeq: input.view.last_seq,
    sourceCommit: TECHNOCORE_SOURCE_COMMIT,
    syncedAt: input.syncedAt,
    epochRewind,
    gap,
    observations,
    rewound: newEpoch,
  };
}
