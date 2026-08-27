import { getObserverIndex } from '@/db/queries';
import { FOUNDRY_ROOM } from '@/lib/technocore-observer';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getObserverIndex(FOUNDRY_ROOM), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Observer index is temporarily unavailable.' }, { status: 503 });
  }
}
