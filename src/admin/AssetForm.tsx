import { useState } from 'react';

import { api } from '@/api';

import type { AdminAsset } from '../../server/payloads.ts';
import type { AssetInput } from '../../server/validate.ts';

interface AssetFormProps {
  /** The asset being edited, or `null` when a new one is being added. */
  editing: AdminAsset | null;
  metadata: AssetInput | null;
  onCancel: () => void;
  onSaved: (asset: AdminAsset) => void;
}

function toPriceInput(priceCents: number | null): string {
  return priceCents === null ? '' : (priceCents / 100).toFixed(2);
}

function toCents(price: string): number | null {
  const trimmed = price.trim();
  if (trimmed === '')
    return null;

  const amount = Number.parseFloat(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : Number.NaN;
}

/** Add or edit one prize. Every field stays editable, whatever the page gave us. */
export function AssetForm({ editing, metadata, onCancel, onSaved }: AssetFormProps) {
  // The parent remounts this form when the draft changes (through its `key`),
  // so the fields start from the draft and stay put while it is being edited.
  const [source, setSource] = useState<AssetInput | null>(() => editing ?? metadata);
  const [url, setUrl] = useState(() => editing?.assetUrl ?? metadata?.assetUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [price, setPrice] = useState(() => toPriceInput(editing?.priceCents ?? metadata?.priceCents ?? null));

  /** For a prize the Asset Store page cannot provide, or that is not on the store. */
  function startBlank(): void {
    setSource({
      name: '',
      assetId: '',
      assetUrl: url.trim(),
      category: null,
      currency: 'USD',
      imageUrl: null,
      notes: null,
      priceCents: null,
      publisher: null,
    });
    setPrice('');
    setMessage(null);
  }

  async function readPage(): Promise<void> {
    setBusy(true);
    setMessage(null);

    try {
      const lookup = await api.metadata(url);
      setSource(lookup.metadata);
      setPrice(toPriceInput(lookup.metadata.priceCents));
      setUrl(lookup.metadata.assetUrl);

      setMessage(lookup.existingAsset === null
        ? 'Read the page. Check the fields, then save.'
        : `Careful: "${lookup.existingAsset.name}" is already in the list with the same Unity id.`);
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (source === null)
      return;

    const priceCents = toCents(price);
    if (Number.isNaN(priceCents)) {
      setMessage('The price should be a number, for example 32.50.');
      return;
    }

    const input: AssetInput = {
      ...source,
      assetUrl: url.trim() === '' ? source.assetUrl : url.trim(),
      currency: source.currency === '' ? 'USD' : source.currency,
      priceCents,
    };

    setBusy(true);
    setMessage(null);

    try {
      const saved = editing === null
        ? await api.createAsset(input)
        : await api.updateAsset(editing.id, input);

      onSaved(saved.asset);
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  function update<K extends keyof AssetInput>(key: K, value: AssetInput[K]): void {
    setSource(current => (current === null ? current : { ...current, [key]: value }));
  }

  return (
    <section className="panel">
      <h2>{editing === null ? 'Add a prize' : `Edit "${editing.name}"`}</h2>

      <div className="field-row">
        <label className="field field-grow">
          <span>Asset Store URL</span>
          <input
            onChange={event => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && url.trim() !== '') {
                event.preventDefault();
                void readPage();
              }
            }}
            placeholder="https://assetstore.unity.com/packages/…-123456"
            type="url"
            value={url}
          />
        </label>
        <button className="button" disabled={busy || url.trim() === ''} onClick={() => void readPage()} type="button">
          Read the page
        </button>
        <button className="button-quiet" onClick={startBlank} type="button">
          Fill in by hand
        </button>
      </div>

      {source === null
        ? <p className="hint">Paste an Asset Store URL and read it, or fill the fields in by hand — the URL is needed either way.</p>
        : (
            <form className="form-grid" onSubmit={event => void save(event)}>
              <label className="field">
                <span>Name</span>
                <input onChange={event => update('name', event.target.value)} required value={source.name} />
              </label>

              <label className="field">
                <span>Publisher</span>
                <input
                  onChange={event => update('publisher', event.target.value)}
                  value={source.publisher ?? ''}
                />
              </label>

              <label className="field">
                <span>Category</span>
                <input onChange={event => update('category', event.target.value)} value={source.category ?? ''} />
              </label>

              <label className="field">
                <span>{`Price in ${source.currency || 'the currency below'}`}</span>
                <input
                  inputMode="decimal"
                  onChange={event => setPrice(event.target.value)}
                  placeholder="leave empty if unknown"
                  value={price}
                />
              </label>

              <label className="field">
                <span>Currency</span>
                <input
                  maxLength={3}
                  onChange={event => update('currency', event.target.value.toUpperCase())}
                  value={source.currency}
                />
              </label>

              <label className="field">
                <span>Unity id</span>
                <input onChange={event => update('assetId', event.target.value)} required value={source.assetId} />
              </label>

              <label className="field field-wide">
                <span>Image URL</span>
                <input onChange={event => update('imageUrl', event.target.value)} value={source.imageUrl ?? ''} />
              </label>

              <label className="field field-wide">
                <span>Internal notes (never public)</span>
                <textarea
                  onChange={event => update('notes', event.target.value)}
                  rows={2}
                  value={source.notes ?? ''}
                />
              </label>

              <div className="form-actions">
                <button className="button" disabled={busy} type="submit">
                  {editing === null ? 'Save the prize' : 'Save changes'}
                </button>
                <button className="button-quiet" onClick={onCancel} type="button">Cancel</button>
              </div>
            </form>
          )}

      {message === null ? null : <p className="hint" role="status">{message}</p>}
      {source?.imageUrl == null || source.imageUrl === ''
        ? null
        : <img alt="" className="preview" src={source.imageUrl} />}
    </section>
  );
}
