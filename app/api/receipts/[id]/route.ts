import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^frc_[a-f0-9]{24}$/.test(id)) {
    return Response.json({ error: 'Invalid receipt identifier.' }, { status: 400 });
  }

  const object = await env.FILES?.get(`receipts/${id}.json`);
  if (!object) return Response.json({ error: 'Receipt not found.' }, { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, immutable',
      'Content-Disposition': `inline; filename="${id}.json"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
