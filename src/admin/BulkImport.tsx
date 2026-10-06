import { useState } from 'react';

import { api } from '@/api';

import type { ImportOutcome } from '../../server/import-assets.ts';
import type { AdminAsset } from '../../server/payloads.ts';

const STATUS_MARKS: Record<string, string> = {
  added: '✓ added',
  duplicate: '• already there',
  failed: '✕ failed',
};

/**
 * Several links in one paste. Each page is read on the server and the prize
 * added straight away with what the page provided — the point being that a
 * batch of twenty donations takes one paste and one wait.
 */
export function BulkImport({ onClose, onDone }: {
  onClose: () => void;
  onDone: (outcome: ImportOutcome, assets: AdminAsset[]) => void;
}) {
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setOutcome(null);

    try {
      const result = await api.importUrls(links);
      setOutcome(result);
      setLinks('');
      onDone(result, result.assets);
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Paste several links</h2>
      <p className="hint">
        One Asset Store link per line, up to 20 at a time. Each page is read and the prize saved with
        its name, publisher, category, price and image — edit any of them afterwards. A publisher the
        list does not know yet becomes an author, so every prize arrives attached; add their Discord
        handle in the Authors panel.
      </p>

      <label className="field field-wide">
        <span>Links</span>
        <textarea
          onChange={event => setLinks(event.target.value)}
          placeholder={'https://assetstore.unity.com/packages/…-169047\nhttps://assetstore.unity.com/packages/…-167811'}
          rows={6}
          value={links}
        />
      </label>

      <div className="field-row">
        <button className="button" disabled={busy || links.trim() === ''} onClick={() => void submit()} type="button">
          {busy ? 'Reading the pages…' : 'Add them all'}
        </button>
        <button className="button-quiet" onClick={onClose} type="button">Close</button>
      </div>

      {error === null ? null : <p className="notice notice-error" role="alert">{error}</p>}

      {outcome === null
        ? null
        : (
            <>
              <p className="hint" role="status">
                {`Added ${outcome.added}, already there ${outcome.duplicates}, failed ${outcome.failed}.`}
              </p>
              <ul className="import-list">
                {outcome.results.map(result => (
                  <li key={result.url}>
                    <span className={`import-status import-${result.status}`}>{STATUS_MARKS[result.status]}</span>
                    <span className="import-name">{result.name ?? result.url}</span>
                    {result.message === null ? null : <span className="muted">{result.message}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
    </section>
  );
}
