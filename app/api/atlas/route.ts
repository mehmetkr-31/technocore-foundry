import { getAtlas } from '@/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getAtlas(), {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' },
    });
  } catch {
    return Response.json({ error: 'Contribution Atlas is temporarily unavailable.' }, { status: 503 });
  }
}
