import { useEffect, useState } from 'react';

import { AssetForm } from '@/admin/AssetForm';
import { AssetTable } from '@/admin/AssetTable';
import { AuthorsPanel } from '@/admin/AuthorsPanel';
import { BulkImport } from '@/admin/BulkImport';
import { Modal } from '@/admin/Modal';
import { api } from '@/api';

import type { ImportOutcome } from '../../server/import-assets.ts';
import type { AdminAsset } from '../../server/payloads.ts';
import type { MetadataPrefill } from '../../server/validate.ts';

import brand from '../../brand.json';

interface Draft {
  editing: AdminAsset | null;
  metadata: MetadataPrefill | null;
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
  const [authorsOpen, setAuthorsOpen] = useState(false);

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

  async function toggleHidden(asset: AdminAsset): Promise<void> {
    try {
      mergeAsset((await api.setHidden(asset.id, !asset.hidden)).asset);
      setNotice(asset.hidden
        ? `"${asset.name}" is back on the public list.`
        : `Hid "${asset.name}" from the public list. It stays here with its keys.`);
    }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      await reload();
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

  const hiddenCount = assets.filter(asset => asset.hidden).length;

  return (
    <div className="page page-wide">
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
                  {hiddenCount === 0 ? null : ` · ${hiddenCount} hidden`}
                </p>
                <div className="field-row">
                  <button
                    className="button"
                    onClick={() => {
                      setImporting(false);
                      setAuthorsOpen(false);
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
                      setAuthorsOpen(false);
                      setImporting(current => !current);
                    }}
                    type="button"
                  >
                    Paste several links
                  </button>
                  <button
                    className="button-quiet"
                    onClick={() => {
                      setDraft(null);
                      setImporting(false);
                      setAuthorsOpen(current => !current);
                    }}
                    type="button"
                  >
                    {authorsOpen ? 'Hide the authors' : 'Authors'}
                  </button>
                </div>
              </div>

              {importing ? <BulkImport onClose={() => setImporting(false)} onDone={afterImport} /> : null}

              {authorsOpen
                ? (
                    <AuthorsPanel
                      onAssetsChanged={setAssets}
                      onClose={() => setAuthorsOpen(false)}
                      onNotice={setNotice}
                    />
                  )
                : null}

              {draft === null
                ? null
                : (
                    <Modal
                      onClose={() => setDraft(null)}
                      title={draft.editing === null ? 'Add a prize' : `Edit "${draft.editing.name}"`}
                    >
                      <AssetForm
                        editing={draft.editing}
                        key={draft.editing?.id ?? draft.metadata?.assetId ?? 'new'}
                        metadata={draft.metadata}
                        onSaved={afterSave}
                      />
                    </Modal>
                  )}

              {assets.length === 0
                ? <p className="notice">Nothing yet. Paste an Asset Store URL to add the first prize.</p>
                : (
                    <AssetTable
                      assets={assets}
                      confirmingId={confirmingId}
                      onAskDelete={setConfirmingId}
                      onAssetChanged={mergeAsset}
                      onCancelDelete={() => setConfirmingId(null)}
                      onDelete={asset => void remove(asset)}
                      onEdit={(asset) => {
                        setImporting(false);
                        setDraft({ editing: asset, metadata: null });
                      }}
                      onToggleKeys={id => setOpenPanel(openPanel === id ? null : id)}
                      onSetNeeded={async (asset, needed) => {
                        try {
                          mergeAsset((await api.setNeeded(asset.id, needed)).asset);
                        }
                        catch (cause) {
                          setNotice(cause instanceof Error ? cause.message : String(cause));
                          await reload();
                        }
                      }}
                      onToggleHidden={asset => void toggleHidden(asset)}
                      openKeys={openPanel}
                    />
                  )}
            </>
          )}
    </div>
  );
}
