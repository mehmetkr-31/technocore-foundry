import { assembleContributionDossier } from '@/lib/contribution-dossier';
import { persistDossier } from '@/lib/server-dossiers';
import { parseStrictJsonBytes } from '@/lib/strict-json';

export const dynamic = 'force-dynamic';

function isRequest(value: unknown): value is { resultId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 &&
    typeof record.resultId === 'string' &&
    /^res_[a-f0-9]{24}$/.test(record.resultId);
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 1_024) throw new Error('oversized');
    input = parseStrictJsonBytes(raw);
  } catch {
    return Response.json({ error: 'Expected a small JSON object containing one resultId.' }, { status: 400 });
  }
  if (!isRequest(input)) return Response.json({ error: 'Invalid dossier request.' }, { status: 400 });

  try {
    const assembled = await assembleContributionDossier(input.resultId);
    const persisted = await persistDossier(assembled);
    return Response.json({
      id: assembled.id,
      schema: assembled.dossier.schema,
      resultId: assembled.dossier.subject.selectedResultId,
      sha256: `sha256:${assembled.sha256}`,
      bytes: assembled.bytes.byteLength,
      snapshotAt: assembled.dossier.snapshotAt,
      rawUrl: `/api/dossiers/${assembled.id}`,
      portableUrl: `/dossier/${assembled.id}`,
      created: persisted.created,
    }, { status: persisted.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'RESULT_NOT_FOUND') return Response.json({ error: 'Result not found.' }, { status: 404 });
    if (message === 'RESULT_NOT_LATEST') return Response.json({ error: 'Only the latest immutable revision can be exported.' }, { status: 409 });
    if (message === 'DOSSIER_TOO_LARGE') return Response.json({ error: 'Dossier exceeds the public export limit.' }, { status: 413 });
    if (/collision/i.test(message)) return Response.json({ error: 'Immutable dossier identifier collision.' }, { status: 409 });
    return Response.json({ error: 'Contribution dossier could not be assembled.' }, { status: 503 });
  }
}
