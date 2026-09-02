import { env } from 'cloudflare:workers';
import { findPublishableResult } from '@/db/queries';
import { createTechnocoreRelayAttemptStore } from '@/db/technocore-relay-attempts';
import { verifyTcr1Receipt, verifyTechnocoreMessage } from '@/lib/foundry-crypto';
import {
  FOUNDRY_PUBLIC_ORIGIN,
  relayConfiguration,
  TECHNOCORE_RELAY_FLAG,
} from '@/lib/technocore-relay-policy';
import { handleTechnocoreRelayPost } from '@/lib/technocore-relay-service';

export const dynamic = 'force-dynamic';

function runtimeRelayConfiguration() {
  const workerEnvironment = env as unknown as Record<string, unknown>;
  const value = (name: typeof TECHNOCORE_RELAY_FLAG | typeof FOUNDRY_PUBLIC_ORIGIN) => {
    const workerValue = workerEnvironment[name];
    if (typeof workerValue === 'string') return workerValue;
    return process.env[name];
  };
  return relayConfiguration({
    [TECHNOCORE_RELAY_FLAG]: value(TECHNOCORE_RELAY_FLAG),
    [FOUNDRY_PUBLIC_ORIGIN]: value(FOUNDRY_PUBLIC_ORIGIN),
  });
}

export async function GET() {
  return Response.json(runtimeRelayConfiguration(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const configuration = runtimeRelayConfiguration();
  if (!configuration.enabled || !configuration.publicOrigin) {
    return Response.json({ error: configuration.reason, code: configuration.code }, { status: 403 });
  }
  if (!env.DB) {
    return Response.json({ error: 'The durable relay attempt store is unavailable; no upstream request was made.', code: 'reservation_unavailable' }, { status: 503 });
  }
  return handleTechnocoreRelayPost(request, configuration, {
    verifyMessage: verifyTechnocoreMessage,
    verifyResultReceipt: verifyTcr1Receipt,
    findPublishableResult,
    attempts: createTechnocoreRelayAttemptStore(env.DB),
    upstreamFetch: fetch,
  });
}
