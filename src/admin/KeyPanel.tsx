import { useState } from 'react';

import { keyNeed } from '@/admin/asset-table';
import { api } from '@/api';

import type { AdminAsset } from '../../server/payloads.ts';

/** One stored key: the value, and a way to remove it. */
function KeyRow({ asset, onChanged, record }: {
  asset: AdminAsset;
  onChanged: (asset: AdminAsset) => void;
  record: AdminAsset['keys'][number];
}) {
  const [message, setMessage] = useState<string | null>(null);

  async function remove(): Promise<void> {
    try {
      onChanged((await api.deleteKey(asset.id, record.id)).asset);
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <li className="key-row">
      <code className="key-value">{record.keyValue}</code>
      <button className="button-small button-danger" onClick={() => void remove()} type="button">Remove</button>
      {message === null ? null : <span className="key-error" role="alert">{message}</span>}
    </li>
  );
}

/** The author behind a prize, and the keys the author donated. Both private. */
export function KeyPanel({ asset, onChanged }: { asset: AdminAsset; onChanged: (asset: AdminAsset) => void }) {
  const [handle, setHandle] = useState(() => asset.contact?.discordHandle ?? '');
  const [notes, setNotes] = useState(() => asset.contact?.contactNotes ?? '');
  const [pasted, setPasted] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function saveContact(): Promise<void> {
    setMessage(null);

    try {
      onChanged((await api.saveContact(asset.id, { contactNotes: notes.trim() === '' ? null : notes.trim(), discordHandle: handle.trim() })).asset);
      setMessage('Contact saved.');
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function addKeys(): Promise<void> {
    setMessage(null);

    try {
      const result = await api.addKeys(asset.id, pasted);
      onChanged(result.asset);
      setPasted('');
      setMessage(result.skipped === 0
        ? `Added ${result.added} key${result.added === 1 ? '' : 's'}.`
        : `Added ${result.added}, skipped ${result.skipped} already stored.`);
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const { needed, obtained, state } = keyNeed(asset);
  const stock = asset.keys.length === 0
    ? 'No keys stored yet.'
    : `${obtained} ${obtained === 1 ? 'key' : 'keys'} stored.`;

  return (
    <div className="key-panel">
      <div className="field-row">
        <label className="field field-grow">
          <span>Discord handle (private)</span>
          <input onChange={event => setHandle(event.target.value)} placeholder="author#1234" value={handle} />
        </label>
        <label className="field field-grow">
          <span>Author notes (private)</span>
          <input onChange={event => setNotes(event.target.value)} value={notes} />
        </label>
        <button className="button-small" disabled={handle.trim() === ''} onClick={() => void saveContact()} type="button">
          Save contact
        </button>
      </div>

      <label className="field field-wide">
        <span>Add keys</span>
        <textarea
          onChange={event => setPasted(event.target.value)}
          placeholder="Paste the keys the author sent, one per line"
          rows={2}
          value={pasted}
        />
      </label>
      <div className="field-row">
        <button className="button-small" disabled={pasted.trim() === ''} onClick={() => void addKeys()} type="button">
          Add keys
        </button>
        <p className="hint">
          {needed === 0
            ? stock
            : `${stock} The winners asked for ${needed}${state === 'short' ? `, ${needed - obtained} still to get` : ', all here'}.`}
        </p>
      </div>

      {asset.keys.length === 0
        ? null
        : (
            <ul className="key-list">
              {asset.keys.map(key => <KeyRow asset={asset} key={key.id} onChanged={onChanged} record={key} />)}
            </ul>
          )}

      {message === null ? null : <p className="hint" role="status">{message}</p>}
    </div>
  );
}
