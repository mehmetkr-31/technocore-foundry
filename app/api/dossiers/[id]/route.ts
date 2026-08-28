import { loadDossierBytes } from '@/lib/server-dossiers';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^fds_[a-f0-9]{24}$/.test(id)) {
    return Response.json({ error: 'Invalid dossier identifier.' }, { status: 400 });
  }
  try {
    const loaded = await loadDossierBytes(id);
    if (!loaded) return Response.json({ error: 'Dossier not found.' }, { status: 404 });
    return new Response(loaded.bytes, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(loaded.bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${id}.foundry-dossier.json"`,
        'ETag': `"sha256-${loaded.record.sha256}"`,
        'X-Content-SHA256': loaded.record.sha256,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Dossier storage integrity check failed.' }, { status: 503 });
  }
}
