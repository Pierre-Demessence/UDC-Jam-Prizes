import { Fragment, useEffect, useState } from 'react';

import { AuthorForm } from '@/admin/AuthorForm';
import { api } from '@/api';

import type { AdminAsset, AdminAuthor } from '../../server/payloads.ts';

interface AuthorsPanelProps {
  /** Prizes changed under the table: the fresh list takes over. */
  onAssetsChanged: (assets: AdminAsset[]) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}

/**
 * The author table's columns — publisher, handle, id, prizes, actions — so the
 * attach row can span them.
 */
const ATTACH_COLUMNS = 5;

function prizeCount(count: number): string {
  return `${count} ${count === 1 ? 'prize' : 'prizes'}`;
}

/**
 * The authors behind the prizes. Editing them once here is the point: the store
 * publisher is what a prize matches on, so this panel is also where a whole back
 * catalogue is attached to its author in one click.
 */
export function AuthorsPanel({ onAssetsChanged, onClose, onNotice }: AuthorsPanelProps) {
  const [authors, setAuthors] = useState<AdminAuthor[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminAuthor | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [attaching, setAttaching] = useState<AdminAuthor | null>(null);
  const [publisher, setPublisher] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const { authors: list } = await api.authors();
      setAuthors(list);
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function remove(author: AdminAuthor): Promise<void> {
    setBusy(true);
    setMessage(null);

    try {
      const { assets, unlinked } = await api.deleteAuthor(author.id);
      setConfirmingId(null);
      // An editor or an attach panel left open on the author just deleted would
      // save into nothing.
      setEditing(current => (current?.id === author.id ? null : current));
      setAttaching(current => (current?.id === author.id ? null : current));
      onAssetsChanged(assets);
      onNotice(unlinked === 0
        ? `Deleted "${author.label}". No prize was attached to it.`
        : `Deleted "${author.label}"; ${prizeCount(unlinked)} now have no author.`);
      await reload();
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  async function attach(author: AdminAuthor): Promise<void> {
    setBusy(true);
    setMessage(null);

    try {
      const { assets, attached } = await api.attachAuthor(author.id, publisher);
      onAssetsChanged(assets);
      onNotice(attached === 0
        ? `No prize is published as "${publisher.trim()}".`
        : `Attached ${prizeCount(attached)} to "${author.label}".`);
      setAttaching(null);
      setPublisher('');
      await reload();
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="toolbar">
        <h2>Authors</h2>
        <div className="field-row">
          <button
            className="button"
            onClick={() => {
              setEditing(null);
              setCreating(current => !current);
            }}
            type="button"
          >
            New author
          </button>
          <button className="button-quiet" onClick={onClose} type="button">Close</button>
        </div>
      </div>

      {creating || editing !== null
        ? (
            <AuthorForm
              editing={editing}
              key={editing?.id ?? 'new'}
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
              onSaved={(author) => {
                setCreating(false);
                setEditing(null);
                setAuthors(current => (current.some(candidate => candidate.id === author.id)
                  ? current.map(candidate => (candidate.id === author.id ? author : candidate))
                  : [...current, author].sort((left, right) => left.label.localeCompare(right.label))));
                onNotice(`Saved "${author.label}".`);
              }}
            />
          )
        : null}

      {authors.length === 0
        ? <p className="notice">No authors yet. Add one here, or from a prize as you add it.</p>
        : (
            <div className="table-scroll">
              <table aria-label="Authors behind the prizes" className="admin-table author-table">
                <thead>
                  <tr>
                    <th scope="col" title="The publisher name on the store page, which is what a prize matches on.">
                      Publisher
                    </th>
                    <th scope="col" title="Private: the Discord handle, which the author can change, and which names them on screen.">
                      Handle
                    </th>
                    <th scope="col" title="Private: the Discord id, which does not change when the handle does.">
                      Discord id
                    </th>
                    <th className="cell-number" scope="col" title="How many prizes are attached.">Prizes</th>
                    <th aria-label="Actions" className="cell-actions" scope="col" title="Edit the author, attach prizes by publisher, or delete it." />
                  </tr>
                </thead>
                <tbody>
                  {authors.map((author) => {
                    const attached = author.assetCount;

                    return (
                      <Fragment key={author.id}>
                        <tr>
                          <th className="cell-name" scope="row">
                            {author.publisher ?? <span className="muted">unknown</span>}
                          </th>
                          <td>{author.discordHandle ?? <span className="muted">—</span>}</td>
                          <td>{author.discordId ?? <span className="muted">—</span>}</td>
                          <td className="cell-number" title={`${prizeCount(attached)} attached to ${author.label}.`}>
                            {attached}
                          </td>
                          <td className="cell-actions">
                            {confirmingId === author.id
                              ? (
                                  <span className="confirm-delete">
                                    <span>Delete the author only?</span>
                                    <button
                                      className="button-small button-danger"
                                      disabled={busy}
                                      onClick={() => void remove(author)}
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
                                  <>
                                    <button
                                      className="button-small"
                                      onClick={() => {
                                        setCreating(false);
                                        setEditing(author);
                                      }}
                                      type="button"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      aria-controls={`attach-${author.id}`}
                                      aria-expanded={attaching?.id === author.id}
                                      className="button-small"
                                      onClick={() => {
                                        setAttaching(current => (current?.id === author.id ? null : author));
                                        setPublisher(author.publisher ?? '');
                                      }}
                                      title="Link every prize published under a publisher name to this author."
                                      type="button"
                                    >
                                      Attach prizes
                                    </button>
                                    <button
                                      className="button-small button-danger"
                                      onClick={() => setConfirmingId(author.id)}
                                      title="The prizes stay; they simply come back with no author."
                                      type="button"
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                          </td>
                        </tr>
                        {attaching?.id === author.id
                          ? (
                              <tr className="row-keys" id={`attach-${author.id}`}>
                                <td colSpan={ATTACH_COLUMNS}>
                                  <div className="field-row">
                                    <label className="field field-grow">
                                      <span>Publisher name, exactly as the store writes it</span>
                                      <input onChange={event => setPublisher(event.target.value)} value={publisher} />
                                    </label>
                                    <button
                                      className="button-small"
                                      disabled={busy || publisher.trim() === ''}
                                      onClick={() => void attach(author)}
                                      type="button"
                                    >
                                      Attach every matching prize
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

      {message === null ? null : <p className="notice notice-error" role="alert">{message}</p>}
    </section>
  );
}
