import { type TechnocoreSignedMessage, verifyTechnocoreMessage } from '@/lib/foundry-crypto';

export const dynamic = 'force-dynamic';

const ROOM = 'foundry-contributions';
const TECHNOCORE_ORIGIN = 'https://technocore.chat';

function looksLikeMessage(value: unknown): value is TechnocoreSignedMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<TechnocoreSignedMessage>;
  return Boolean(
    message.room === ROOM &&
    typeof message.did === 'string' && message.did.length <= 160 &&
    typeof message.sig === 'string' && message.sig.length <= 100 &&
    typeof message.nonce === 'string' && /^\d{1,40}$/.test(message.nonce) &&
    typeof message.text === 'string' && message.text.length >= 30 && message.text.length <= 4096,
  );
}

export async function POST(request: Request) {
  let message: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new Error('oversized');
    message = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Expected a signed Technocore announcement.' }, { status: 400 });
  }
  if (!looksLikeMessage(message)) return Response.json({ error: 'Malformed Technocore announcement.' }, { status: 400 });
  if (!message.text.startsWith('[FOUNDRY]') || !message.text.includes('/api/receipts/')) {
    return Response.json({ error: 'Only Foundry receipt announcements can use this relay.' }, { status: 400 });
  }
  try {
    if (!(await verifyTechnocoreMessage(message))) return Response.json({ error: 'Technocore message signature is invalid.' }, { status: 400 });
    const upstream = await fetch(`${TECHNOCORE_ORIGIN}/r/${ROOM}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Technocore-Foundry/1.0' },
      body: JSON.stringify({ did: message.did, sig: message.sig, nonce: message.nonce, text: message.text }),
      signal: AbortSignal.timeout(8_000),
    });
    const detail = (await upstream.text()).slice(0, 500);
    if (!upstream.ok) return Response.json({ error: 'Technocore rejected the announcement.', upstreamStatus: upstream.status, detail }, { status: 502 });
    return Response.json({ status: 'published', room: ROOM, upstreamStatus: upstream.status, detail });
  } catch {
    return Response.json({ error: 'Technocore is temporarily unreachable. Download the signed package and retry later.' }, { status: 503 });
  }
}
