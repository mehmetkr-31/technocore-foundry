import type { ObserverEpochRecord, ObserverGapRecord, TransportObservationRecord } from '@/db/queries';
import { sha256Hex } from './foundry-crypto';

export const TECHNOCORE_ORIGIN = 'https://technocore.chat' as const;
export const FOUNDRY_ROOM = 'foundry-contributions' as const;
export const TECHNOCORE_SOURCE_COMMIT = '9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c' as const;
const RECEIPT_PATTERN = /\b(?:frc|fms|res|fac|fcr|frv|fat|tcf)_[a-f0-9]{24}\b/;

export type TechnocoreRoomMessage = { seq: number; ts: string; from: string; text: string };
export type TechnocoreRoomView = {
  room: string;
  count: number;
  first_seq: number | null;
  last_seq: number;
  messages: TechnocoreRoomMessage[];
};

export function parseRoomView(value: unknown): TechnocoreRoomView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Technocore returned a malformed room view.');
  const view = value as Record<string, unknown>;
  if (view.room !== FOUNDRY_ROOM || !Number.isSafeInteger(view.count) || Number(view.count) < 0 || !Number.isSafeInteger(view.last_seq) || Number(view.last_seq) < 0 || !Array.isArray(view.messages)) {
    throw new Error('Technocore returned an unexpected room envelope.');
  }
  if (view.first_seq !== null && (!Number.isSafeInteger(view.first_seq) || Number(view.first_seq) < 1)) throw new Error('Technocore returned an invalid first_seq.');
  if (view.messages.length > 200) throw new Error('Technocore returned too many messages.');
  let prior = 0;
  const messages = view.messages.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Technocore returned a malformed message.');
    const message = item as Record<string, unknown>;
    if (!Number.isSafeInteger(message.seq) || Number(message.seq) < 1 || Number(message.seq) <= prior) throw new Error('Technocore message sequence is invalid.');
    if (typeof message.ts !== 'string' || message.ts.length > 64 || !Number.isFinite(Date.parse(message.ts))) throw new Error('Technocore message timestamp is invalid.');
    if (typeof message.from !== 'string' || message.from.length < 1 || message.from.length > 160) throw new Error('Technocore message actor is invalid.');
    if (typeof message.text !== 'string' || message.text.length > 4096 || /[\r\n]/.test(message.text)) throw new Error('Technocore message text is invalid.');
    prior = Number(message.seq);
    return { seq: prior, ts: message.ts, from: message.from, text: message.text };
  });
  if (messages.length !== Number(view.count) || (messages[0]?.seq ?? null) !== view.first_seq || (messages.at(-1)?.seq ?? Number(view.last_seq)) !== Number(view.last_seq)) {
    throw new Error('Technocore room counters do not match the returned messages.');
  }
  return { room: FOUNDRY_ROOM, count: Number(view.count), first_seq: view.first_seq as number | null, last_seq: Number(view.last_seq), messages };
}

function actorHint(value: string) {
  return /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(value) ? value : 'unsigned-or-self-asserted';
}

export async function planObserverSync(input: {
  current: ObserverEpochRecord | null;
  tailSeq: number;
  view: TechnocoreRoomView;
  syncedAt: string;
}) {
  const rewound = Boolean(input.current && input.tailSeq < input.current.endSeq);
  const epoch = input.current ? input.current.epoch + (rewound ? 1 : 0) : 0;
  const cursor = input.current && !rewound ? input.current.endSeq : 0;
  const firstReturned = input.view.first_seq ?? cursor;
  const gap = input.view.first_seq !== null && input.view.first_seq > cursor + 1
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
  const epochRewind: ObserverGapRecord | null = rewound && input.current
    ? {
        id: `${FOUNDRY_ROOM}:${epoch}:rewind:${input.current.endSeq + 1}:${input.tailSeq}`,
        room: FOUNDRY_ROOM,
        epoch,
        kind: 'epoch_rewind',
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
    verificationState: 'transport_unverifiable' as const,
    observedAt: input.syncedAt,
  })));
  return {
    room: FOUNDRY_ROOM,
    epoch,
    priorEpoch: input.current?.epoch ?? null,
    startSeq: firstReturned,
    endSeq: input.view.last_seq,
    sourceCommit: TECHNOCORE_SOURCE_COMMIT,
    syncedAt: input.syncedAt,
    epochRewind,
    gap,
    observations,
    rewound,
  };
}
