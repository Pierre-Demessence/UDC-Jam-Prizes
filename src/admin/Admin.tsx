import { useEffect, useState } from 'react';

import { AssetForm } from '@/admin/AssetForm';
import { BulkImport } from '@/admin/BulkImport';
import { KeyPanel } from '@/admin/KeyPanel';
import { api } from '@/api';
import { formatPrice } from '@/format';

import type { ImportOutcome } from '../../server/import-assets.ts';
import type { AdminAsset } from '../../server/payloads.ts';
import type { AssetInput } from '../../server/validate.ts';

import brand from '../../brand.json';

interface Draft {
  editing: AdminAsset | null;
  metadata: AssetInput | null;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.signIn(password);
      setPassword('');
      onSignedIn();
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-narrow" onSubmit={event => void submit(event)}>
      <h2>Admin</h2>
      <p className="hint">The prize list is public; only you can change it.</p>
      <label className="field">
        <span>Password</span>
        <input
          autoComplete="current-password"
          onChange={event => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </label>
      <button className="button" disabled={busy || password === ''} type="submit">Sign in</button>
      {error === null ? null : <p className="notice notice-error" role="alert">{error}</p>}
    </form>
  );
}

export function Admin() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<number | null>(null);

  useEffect(() => {
    document.title = `Admin · ${brand.name}`;
  }, []);

  useEffect(() => {
    api.session()
      .then(session => setAuthenticated(session.authenticated))
      .catch((cause: unknown) => {
        // A refused address or a broken API both end up here: say which.
        setNotice(cause instanceof Error ? cause.message : String(cause));
        setAuthenticated(false);
      });
  }, []);

  useEffect(() => {
    if (authenticated === true)
      void reload();
  }, [authenticated]);

  async function reload(): Promise<void> {
    try {
      const { assets: list } = await api.adminAssets();
      setAssets(list);
    }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function mergeAsset(asset: AdminAsset): void {
    setAssets(current => current.map(candidate => (candidate.id === asset.id ? asset : candidate)));
  }

  function afterSave(asset: AdminAsset): void {
    setDraft(null);
    setNotice(`Saved "${asset.name}".`);
    void reload();
  }

  function afterImport(outcome: ImportOutcome, imported: AdminAsset[]): void {
    // The panel stays open: its per-link list is the only place that says which
    // links failed and why.
    setAssets(imported);
    setNotice(outcome.failed === 0
      ? `Added ${outcome.added} ${outcome.added === 1 ? 'prize' : 'prizes'}.`
      : `Added ${outcome.added}, ${outcome.failed} could not be read.`);
  }

  async function remove(asset: AdminAsset): Promise<void> {
    try {
      await api.deleteAsset(asset.id);
      setConfirmingId(null);
      setNotice(`Deleted "${asset.name}".`);
      await reload();
    }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function signOut(): Promise<void> {
    try {
      await api.signOut();
    }
    catch (cause) {
      // Signing out locally is still the right outcome when the request fails.
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }

    setAuthenticated(false);
    setAssets([]);
  }

  return (
    <div className="page">
      <header className="site-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{brand.name}</h1>
        </div>
        <nav className="header-actions">
          <a className="button-quiet" href="/">See the public list</a>
          {authenticated === true
            ? <button className="button-quiet" onClick={() => void signOut()} type="button">Sign out</button>
            : null}
        </nav>
      </header>

      {notice === null ? null : <p className="notice" role="status">{notice}</p>}

      {authenticated === null ? <p className="notice">Checking your session…</p> : null}

      {authenticated === false ? <SignIn onSignedIn={() => setAuthenticated(true)} /> : null}

      {authenticated !== true
        ? null
        : (
            <>
              <div className="toolbar">
                <p className="meta-line">
                  <strong>{assets.length}</strong>
                  {' '}
                  {assets.length === 1 ? 'prize' : 'prizes'}
                  {' '}
                  in the list
                </p>
                <div className="field-row">
                  <button
                    className="button"
                    onClick={() => {
                      setImporting(false);
                      setDraft({ editing: null, metadata: null });
                    }}
                    type="button"
                  >
                    Add a prize
                  </button>
                  <button
                    className="button-quiet"
                    onClick={() => {
                      setDraft(null);
                      setImporting(current => !current);
                    }}
                    type="button"
                  >
                    Paste several links
                  </button>
                </div>
              </div>

              {importing ? <BulkImport onClose={() => setImporting(false)} onDone={afterImport} /> : null}

              {draft === null
                ? null
                : (
                    <AssetForm
                      editing={draft.editing}
                      key={draft.editing?.id ?? draft.metadata?.assetId ?? 'new'}
                      metadata={draft.metadata}
                      onCancel={() => setDraft(null)}
                      onSaved={afterSave}
                    />
                  )}

              {assets.length === 0
                ? <p className="notice">Nothing yet. Paste an Asset Store URL to add the first prize.</p>
                : (
                    <ul className="admin-list">
                      {assets.map(asset => (
                        <li className="admin-row" key={asset.id}>
                          <div className="admin-row-main">
                            <div className="admin-row-title">
                              <a href={asset.assetUrl} rel="noreferrer" target="_blank">{asset.name}</a>
                              {asset.publisher === null
                                ? null
                                : <span className="muted">{`by ${asset.publisher}`}</span>}
                            </div>
                            <p className="admin-row-meta">
                              <span title="Read from the Asset Store page; edit it if it is wrong.">
                                {formatPrice(asset.priceCents, asset.currency)}
                              </span>
                              <span title="Keys are private; winners only see the asset.">
                                {asset.keys.length}
                                {' '}
                                {asset.keys.length === 1 ? 'key' : 'keys'}
                              </span>
                              <span title="Discord handle and notes are private.">
                                {asset.contact === null ? 'no contact yet' : asset.contact.discordHandle}
                              </span>
                            </p>
                          </div>

                          <div className="admin-row-actions">
                            <button
                              className="button-small"
                              onClick={() => {
                                setImporting(false);
                                setDraft({ editing: asset, metadata: null });
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              aria-expanded={openPanel === asset.id}
                              className="button-small"
                              onClick={() => setOpenPanel(openPanel === asset.id ? null : asset.id)}
                              type="button"
                            >
                              Author &amp; keys
                            </button>
                            {confirmingId === asset.id
                              ? (
                                  <span className="confirm-delete">
                                    <span>Delete this prize and its keys?</span>
                                    <button
                                      className="button-small button-danger"
                                      onClick={() => void remove(asset)}
                                      type="button"
                                    >
                                      Yes, delete
                                    </button>
                                    <button className="button-small" onClick={() => setConfirmingId(null)} type="button">
                                      Keep it
                                    </button>
                                  </span>
                                )
                              : (
                                  <button
                                    className="button-small button-danger"
                                    onClick={() => setConfirmingId(asset.id)}
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                )}
                          </div>

                          {openPanel === asset.id ? <KeyPanel asset={asset} onChanged={mergeAsset} /> : null}
                        </li>
                      ))}
                    </ul>
                  )}
            </>
          )}
    </div>
  );
}
