import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  let databaseReady = false;
  let filesReady = false;
  try {
    if (env.DB) {
      await ensureDatabase();
      const result = await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM missions WHERE id IN ('M-042', 'M-039', 'M-031')) AS seedCount,
        (SELECT COUNT(*) FROM pragma_table_info('technocore_relay_attempts') WHERE name = 'completed_at') AS relaySchema`)
        .first<{ seedCount: number; relaySchema: number }>();
      databaseReady = Number(result?.seedCount) === 3 && Number(result?.relaySchema) === 1;
    }
  } catch {
    databaseReady = false;
  }
  try {
    if (env.FILES) {
      await env.FILES.head('__foundry_health__/readiness');
      filesReady = true;
    }
  } catch {
    filesReady = false;
  }
  const ready = databaseReady && filesReady;
  return Response.json({
    schema: 'foundry-local-health-v1',
    status: ready ? 'ready' : 'unavailable',
    database: databaseReady ? 'ready' : 'unavailable',
    files: filesReady ? 'ready' : 'unavailable',
  }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
