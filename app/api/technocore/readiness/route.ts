import { handleTechnocoreReadinessGet, handleTechnocoreReadinessPost } from '@/lib/technocore-readiness-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleTechnocoreReadinessGet(request, { upstreamFetch: fetch });
}

export async function POST(request: Request) {
  return handleTechnocoreReadinessPost(request, { upstreamFetch: fetch });
}
