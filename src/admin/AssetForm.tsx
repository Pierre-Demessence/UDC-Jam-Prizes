import { useEffect, useState } from 'react';

import { authorExtras } from '@/admin/asset-table';
import { AuthorForm } from '@/admin/AuthorForm';
import { api } from '@/api';

import type { AdminAsset, AdminAuthor } from '../../server/payloads.ts';
import type { AssetInput } from '../../server/validate.ts';

interface AssetFormProps {
  /** The asset being edited, or `null` when a new one is being added. */
  editing: AdminAsset | null;
  metadata: AssetInput | null;
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

/** The editable fields of a stored prize, so the form works on one shape. */
function toInput(asset: AdminAsset): AssetInput {
  return {
    name: asset.name,
    assetId: asset.assetId,
    assetUrl: asset.assetUrl,
    authorId: asset.author?.id ?? null,
    category: asset.category,
    imageUrl: asset.imageUrl,
    notes: asset.notes,
    priceCents: asset.priceCents,
    publisher: asset.publisher,
  };
}

/** Add or edit one prize. Every field stays editable, whatever the page gave us. */
export function AssetForm({ editing, metadata, onSaved }: AssetFormProps) {
  // The parent remounts this form when the draft changes (through its `key`),
  // so the fields start from the draft and stay put while it is being edited.
  const [source, setSource] = useState<AssetInput | null>(() => (editing === null ? metadata : toInput(editing)));
  const [authors, setAuthors] = useState<AdminAuthor[]>([]);
  const [choosingAuthor, setChoosingAuthor] = useState(false);
  const [url, setUrl] = useState(() => editing?.assetUrl ?? metadata?.assetUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [price, setPrice] = useState(() => toPriceInput(editing?.priceCents ?? metadata?.priceCents ?? null));

  // The author list is small and barely changes, so one read per form is enough.
  useEffect(() => {
    api.authors()
      .then(result => setAuthors(result.authors))
      .catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const sourceAuthorId = source?.authorId ?? null;
  const attached = sourceAuthorId === null ? null : authors.find(author => author.id === sourceAuthorId) ?? null;

  /** For a prize the Asset Store page cannot provide, or that is not on the store. */
  function startBlank(): void {
    setSource({
      name: '',
      assetId: '',
      assetUrl: url.trim(),
      authorId: null,
      category: null,
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

      const matched = lookup.metadata.authorId === null ? '' : ' The publisher matched an author, already chosen below.';
      setMessage(lookup.existingAsset === null
        ? `Read the page. Check the fields, then save.${matched}`
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
    <div className="modal-form">
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

              <div className="field field-wide">
                <span id="prize-author-label">Author (private)</span>
                <div className="field-row">
                  <select
                    aria-labelledby="prize-author-label"
                    className="field-grow"
                    onChange={event => update('authorId', event.target.value === '' ? null : Number(event.target.value))}
                    value={sourceAuthorId ?? ''}
                  >
                    <option value="">Nobody yet</option>
                    {authors.map(author => (
                      <option key={author.id} value={author.id}>{author.label}</option>
                    ))}
                  </select>
                  <button
                    className="button-quiet"
                    onClick={() => setChoosingAuthor(current => !current)}
                    type="button"
                  >
                    {choosingAuthor ? 'Cancel the new author' : 'New author'}
                  </button>
                </div>
                <span className="hint">
                  {attached === null
                    ? 'No author attached. Create one once — their other prizes find them by the publisher name.'
                    : authorExtras(attached).join(' · ') || 'Nothing else recorded.'}
                </span>
              </div>

              {choosingAuthor
                ? (
                    <div className="field-wide">
                      <AuthorForm
                        editing={null}
                        onSaved={(author) => {
                          setAuthors(current => [...current, author].sort((left, right) => left.label.localeCompare(right.label)));
                          update('authorId', author.id);
                          setChoosingAuthor(false);
                        }}
                        publisher={source.publisher}
                      />
                    </div>
                  )
                : null}

              <label className="field">
                <span>Category</span>
                <input onChange={event => update('category', event.target.value)} value={source.category ?? ''} />
              </label>

              <label className="field">
                <span>Price (USD)</span>
                <input
                  inputMode="decimal"
                  onChange={event => setPrice(event.target.value)}
                  placeholder="leave empty if unknown"
                  value={price}
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
              </div>
            </form>
          )}

      {message === null ? null : <p className="hint" role="status">{message}</p>}
      {source?.imageUrl == null || source.imageUrl === ''
        ? null
        : <img alt="" className="preview" src={source.imageUrl} />}
    </div>
  );
}
