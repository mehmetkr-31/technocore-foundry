import { env } from 'cloudflare:workers';
import { findResult } from '@/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^res_[a-f0-9]{24}$/.test(id)) return Response.json({ error: 'Invalid result identifier.' }, { status: 400 });
  const result = await findResult(id);
  if (!result) return Response.json({ error: 'Artifact not found.' }, { status: 404 });
  const object = await env.FILES?.get(result.artifactObjectKey);
  if (!object) return Response.json({ error: 'Artifact bytes are unavailable.' }, { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': result.artifactMediaType,
      'Content-Length': String(result.artifactBytes),
      'Content-Disposition': `attachment; filename="${result.artifactName.replace(/["\\]/g, '_')}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
