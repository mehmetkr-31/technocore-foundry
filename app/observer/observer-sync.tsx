'use client';

import { useState } from 'react';

export default function ObserverSync() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/observer/sync', { method: 'POST' });
      const body = await response.json() as { error?: string; added?: number; epoch?: number; gapDetected?: boolean; rewindDetected?: boolean };
      if (!response.ok) throw new Error(body.error ?? `Sync failed with ${response.status}.`);
      setMessage(`Observed ${body.added ?? 0} bounded records in epoch ${body.epoch ?? 0}${body.gapDetected ? '; retention gap recorded' : ''}${body.rewindDetected ? '; room epoch rewind recorded' : ''}.`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Observation failed safely.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="observer-control"><button className="button button-primary" type="button" onClick={sync} disabled={busy}>{busy ? 'Reading fixed lane…' : 'Observe fixed lane'}</button><p role="status">{message || 'Manual read only. No message is published and no URL from a message is fetched.'}</p></div>;
}
