import { handleCloseGet, handleClosePost } from '@/lib/close-call-service';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleCloseGet(request, { upstreamFetch: fetch }); }
export function POST(request: Request) { return handleClosePost(request, { upstreamFetch: fetch }); }
