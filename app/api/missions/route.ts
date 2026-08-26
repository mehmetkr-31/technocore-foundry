import { listMissions } from '@/db/queries';

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
