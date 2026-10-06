import { Fragment, useEffect, useState } from 'react';

import type { Sort, SortKey } from '@/admin/author-table';

import { COLUMNS, DEFAULT_SORT, nextSort, sortAuthors } from '@/admin/author-table';
import { AuthorForm } from '@/admin/AuthorForm';
import { Modal } from '@/admin/Modal';
import { api } from '@/api';
import { publisherPageUrl } from '@/format';

import type { AdminAsset, AdminAuthor } from '../../server/payloads.ts';

interface AuthorsPanelProps {
  /** Prizes changed under the table: the fresh list takes over. */
  onAssetsChanged: (assets: AdminAsset[]) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}

/**
 * The author table's columns — publisher, publisher id, handle, Discord id, prizes,
 * actions — so the attach row can span them.
 */
const ATTACH_COLUMNS = 6;

function prizeCount(count: number): string {
  return `${count} ${count === 1 ? 'prize' : 'prizes'}`;
}

/** The publisher name, linked to their store page when the id is known. */
function PublisherCell({ author }: { author: AdminAuthor }) {
  const storeUrl = publisherPageUrl(author.publisherId);
  if (author.publisher === null)
    return <span className="muted">unknown</span>;

  return storeUrl === null
    ? <>{author.publisher}</>
    : <a href={storeUrl} rel="noreferrer" target="_blank">{author.publisher}</a>;
}

/**
 * The authors behind the prizes, every column sortable. Editing them once here is
 * the point: the store publisher is what a prize matches on, so this panel is also
 * where a whole back catalogue is attached to its author in one click.
 */
export function AuthorsPanel({ onAssetsChanged, onClose, onNotice }: AuthorsPanelProps) {
  const [authors, setAuthors] = useState<AdminAuthor[]>([]);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
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

  const rows = sortAuthors(authors, sort);

  function header(key: SortKey, label: string, title: string, alignEnd?: boolean) {
    const active = sort.key === key;
    const hint = active
      ? `${title} Sorted ${sort.direction === 'ascending' ? 'from A to Z' : 'from Z to A'}; click to turn it around.`
      : `${title} Click to sort by ${label.toLowerCase()}.`;

    return (
      <th
        aria-sort={active ? sort.direction : 'none'}
        className={alignEnd === true ? 'cell-number' : undefined}
        key={key}
        scope="col"
      >
        <button
          className="table-sort"
          onClick={() => setSort(current => nextSort(current, key))}
          title={hint}
          type="button"
        >
          {label}
          {/* A glyph, not just a colour: the arrow says which way the column runs. */}
          <span aria-hidden="true" className="sort-mark">
            {active ? (sort.direction === 'ascending' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
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
              setCreating(true);
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
            <Modal
              onClose={() => {
                setCreating(false);
                setEditing(null);
              }}
              title={editing === null ? 'New author' : `Edit "${editing.label}"`}
            >
              <AuthorForm
                editing={editing}
                key={editing?.id ?? 'new'}
                onSaved={(author) => {
                  setCreating(false);
                  setEditing(null);
                  setAuthors(current => (current.some(candidate => candidate.id === author.id)
                    ? current.map(candidate => (candidate.id === author.id ? author : candidate))
                    : [...current, author]));
                  onNotice(`Saved "${author.label}".`);
                }}
              />
            </Modal>
          )
        : null}

      {authors.length === 0
        ? <p className="notice">No authors yet. Add one here, or from a prize as you add it.</p>
        : (
            <div className="table-scroll">
              <table aria-label="Authors behind the prizes" className="admin-table author-table">
                <thead>
                  <tr>
                    {COLUMNS.map(column => column.key === null
                      ? (
                          <th
                            aria-label={column.label}
                            className="cell-actions"
                            key="actions"
                            scope="col"
                            title={column.title}
                          />
                        )
                      : header(column.key, column.label, column.title, column.alignEnd))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((author) => {
                    const attached = author.assetCount;

                    return (
                      <Fragment key={author.id}>
                        <tr>
                          <th className="cell-name" scope="row">
                            <PublisherCell author={author} />
                          </th>
                          <td>{author.publisherId ?? <span className="muted">—</span>}</td>
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
