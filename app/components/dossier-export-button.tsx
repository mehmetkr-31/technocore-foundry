'use client';

import { useState } from 'react';

type DossierResponse = {
  id: string;
  rawUrl: string;
  portableUrl: string;
};

export function DossierExportButton({ resultId, compact = false }: { resultId: string; compact?: boolean }) {
  const [result, setResult] = useState<DossierResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exportDossier() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/dossiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultId }),
      });
      const body = await response.json() as DossierResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Dossier export failed.');
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dossier export failed.');
    } finally {
      setBusy(false);
    }
  }

  if (result) return (
    <span className={compact ? 'dossier-action compact' : 'dossier-action'}>
      <a className="button button-primary" href={result.portableUrl}>Open dossier</a>
      <a className="button button-secondary" href={result.rawUrl} download>Raw JSON</a>
    </span>
  );
  return (
    <span className={compact ? 'dossier-action compact' : 'dossier-action'}>
      <button className="button button-secondary" type="button" onClick={exportDossier} disabled={busy}>
        {busy ? 'Assembling…' : 'Export dossier'}
      </button>
      {error && <small className="form-error" role="alert">{error}</small>}
    </span>
  );
}
