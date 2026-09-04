import { getCurrentObserverEpoch, getObserverIndex, recordObserverSync } from '@/db/queries';
import { FOUNDRY_ROOM, parseRoomView, planObserverSync, TECHNOCORE_ORIGIN } from '@/lib/technocore-observer';
import { parseLosslessIntegerJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 512 * 1024;

async function boundedJson(response: Response) {
  if (!response.ok) throw new Error(`Technocore read failed with ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error('Technocore response is oversized.');
  if (!response.body) throw new Error('Technocore response body is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('Technocore response is oversized.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return parseLosslessIntegerJsonBytes(bytes);
}

async function readRoom(query: string) {
  const response = await fetch(`${TECHNOCORE_ORIGIN}/r/${FOUNDRY_ROOM}?format=json&${query}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'technocore-foundry-observer/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  return parseRoomView(await boundedJson(response));
}

export async function POST(request: Request) {
  if ((request.headers.get('content-length') ?? '0') !== '0') return Response.json({ error: 'Observer sync accepts no input or external URL.' }, { status: 400 });
  try {
    const current = await getCurrentObserverEpoch(FOUNDRY_ROOM);
    const tail = await readRoom('limit=1');
    const generationChanged = Boolean(current && tail.generation !== current.upstreamGeneration);
    const rewound = Boolean(current && tail.last_seq < current.endSeq);
    const cursor = current && !generationChanged && !rewound ? current.endSeq : 0;
    const view = await readRoom(`since=${cursor}&limit=200`);
    const plan = await planObserverSync({ current, tailSeq: tail.last_seq, tailGeneration: tail.generation, view, syncedAt: new Date().toISOString() });
    await recordObserverSync(plan);
    const index = await getObserverIndex(FOUNDRY_ROOM);
    return Response.json({
      status: 'observed',
      added: plan.observations.length,
      epoch: plan.epoch,
      rewindDetected: plan.rewound,
      gapDetected: Boolean(plan.gap),
      index,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Fixed-lane observer sync failed.', error);
    const detail = error instanceof Error && /failed with \d{3}|oversized|malformed|unexpected|invalid|counters/.test(error.message)
      ? error.message
      : 'Fixed-lane observation failed safely.';
    return Response.json({ error: detail }, { status: 502 });
  }
}
