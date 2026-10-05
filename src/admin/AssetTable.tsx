import { Fragment, useState } from 'react';

import type { KeyNeed, Sort, SortKey } from '@/admin/asset-table';

import { COLUMNS, DEFAULT_SORT, keyNeed, keySummary, needClass, needLabel, nextSort, sortAssets } from '@/admin/asset-table';
import { KeyPanel } from '@/admin/KeyPanel';
import { formatCategory, formatPrice } from '@/format';

import type { AdminAsset } from '../../server/payloads.ts';

interface AssetTableProps {
  assets: AdminAsset[];
  confirmingId: number | null;
  openKeys: number | null;
  onAskDelete: (id: number) => void;
  onAssetChanged: (asset: AdminAsset) => void;
  onCancelDelete: () => void;
  onDelete: (asset: AdminAsset) => void;
  onEdit: (asset: AdminAsset) => void;
  onSetNeeded: (asset: AdminAsset, needed: number) => Promise<void>;
  onToggleHidden: (asset: AdminAsset) => void;
  onToggleKeys: (id: number) => void;
}

/**
 * The request field of one row. The text lives in the table rather than here, so
 * the row's colour and marker follow the keystrokes; this only draws them.
 */
function NeededCell({ asset, need, onChange, onCommit, value }: {
  asset: AdminAsset;
  need: KeyNeed;
  onChange: (text: string) => void;
  onCommit: () => void;
  value: string;
}) {
  return (
    <div className="needed-cell">
      {need.state === 'none'
        ? null
        : (
            <span
              aria-label={need.state === 'short'
                ? `Short: ${needLabel(need)} obtained, ask for ${need.needed - need.obtained} more.`
                : `Covered: all ${need.needed} keys are here or sent.`}
              className={need.state === 'short' ? 'need-mark need-short' : 'need-mark need-covered'}
              role="img"
              title={need.state === 'short'
                ? `Only ${needLabel(need)} obtained: ask the publisher for ${need.needed - need.obtained} more.`
                : `All the keys asked for are here or already sent (${needLabel(need)}).`}
            >
              {/* A glyph as well as the tint: short and covered are red and green,
                  the pair the admin cannot tell apart by colour alone. */}
              {need.state === 'short' ? '!' : '✓'}
            </span>
          )}
      <input
        aria-label={`Keys needed for ${asset.name}`}
        className="needed-input"
        inputMode="numeric"
        min={0}
        onBlur={onCommit}
        onChange={event => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter')
            onCommit();
        }}
        type="number"
        value={value}
      />
    </div>
  );
}

/** What was typed, or the stored value when it is not a usable count yet. */
function numberOrFallback(text: string, fallback: number): number {
  const parsed = Number(text.trim() === '' ? 0 : text.trim());

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999 ? parsed : fallback;
}

/**
 * The prize list as a table: denser than cards, and every column sorts. The key
 * list and the contact fields stay behind the row's own panel — a status select
 * per key does not belong in a cell.
 */
export function AssetTable({
  assets,
  confirmingId,
  onAskDelete,
  onAssetChanged,
  onCancelDelete,
  onDelete,
  onEdit,
  onSetNeeded,
  onToggleHidden,
  onToggleKeys,
  openKeys,
}: AssetTableProps) {
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  /** What is being typed into a row's request field, keyed by prize id. */
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const rows = sortAssets(assets, sort);

  /** The request as typed, so a row changes colour while the number is typed. */
  function neededOf(asset: AdminAsset): number {
    const draft = drafts[asset.id];

    return draft === undefined ? asset.needed : numberOrFallback(draft, asset.needed);
  }

  async function saveNeeded(asset: AdminAsset, typed: string): Promise<void> {
    const parsed = numberOrFallback(typed, asset.needed);

    try {
      if (parsed !== asset.needed)
        await onSetNeeded(asset, parsed);
    }
    finally {
      // The typed text goes once the server has the number (or has refused it).
      setDrafts((current) => {
        const next = { ...current };
        delete next[asset.id];

        return next;
      });
    }
  }

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

  return (
    <div className="table-scroll">
      <table className="admin-table">
        <caption className="table-caption">Prizes in the jam</caption>
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
          {rows.map((asset) => {
            const need = keyNeed({ ...asset, needed: neededOf(asset) });

            return (
              <Fragment key={asset.id}>
                <tr className={[needClass(need), asset.hidden ? 'row-hidden' : null].filter(Boolean).join(' ') || undefined}>
                  <th className="cell-name" scope="row">
                    <a href={asset.assetUrl} rel="noreferrer" target="_blank">{asset.name}</a>
                    {asset.hidden
                      ? <span className="chip chip-hidden" title="Hidden from the public list.">Hidden</span>
                      : null}
                  </th>
                  <td>{asset.publisher ?? <span className="muted">unknown</span>}</td>
                  <td>{formatCategory(asset.category) ?? <span className="muted">uncategorised</span>}</td>
                  <td className="cell-number" title="Read from the Asset Store page; edit it if it is wrong.">
                    {formatPrice(asset.priceCents)}
                  </td>
                  <td className="cell-number" title={keySummary(asset)}>
                    {asset.keys.length}
                  </td>
                  <td className="cell-number">
                    <NeededCell
                      asset={asset}
                      need={need}
                      onChange={text => setDrafts(current => ({ ...current, [asset.id]: text }))}
                      onCommit={() => void saveNeeded(asset, drafts[asset.id] ?? String(asset.needed))}
                      value={drafts[asset.id] ?? String(asset.needed)}
                    />
                  </td>
                  <td>
                    {asset.contact === null
                      ? <span className="muted" title="No Discord handle recorded for this author yet.">—</span>
                      : <span title="Private: this never reaches the public list.">{asset.contact.discordHandle}</span>}
                  </td>
                  <td className="cell-actions">
                    {confirmingId === asset.id
                      ? (
                          <span className="confirm-delete">
                            <span>Delete it and its keys?</span>
                            <button className="button-small button-danger" onClick={() => onDelete(asset)} type="button">
                              Yes, delete
                            </button>
                            <button className="button-small" onClick={onCancelDelete} type="button">Keep it</button>
                          </span>
                        )
                      : (
                          <>
                            <button className="button-small" onClick={() => onEdit(asset)} type="button">Edit</button>
                            <button
                              className="button-small"
                              onClick={() => onToggleHidden(asset)}
                              title={asset.hidden
                                ? 'Put this prize back on the public list.'
                                : 'Take this prize off the public list; it stays here with its keys.'}
                              type="button"
                            >
                              {asset.hidden ? 'Unhide' : 'Hide'}
                            </button>
                            <button
                              aria-controls={`keys-${asset.id}`}
                              aria-expanded={openKeys === asset.id}
                              className="button-small"
                              onClick={() => onToggleKeys(asset.id)}
                              title="The author's Discord handle, notes, and the keys the author donated."
                              type="button"
                            >
                              Keys
                            </button>
                            <button
                              className="button-small button-danger"
                              onClick={() => onAskDelete(asset.id)}
                              type="button"
                            >
                              Delete
                            </button>
                          </>
                        )}
                  </td>
                </tr>
                {openKeys === asset.id
                  ? (
                      <tr className="row-keys" id={`keys-${asset.id}`}>
                        <td colSpan={COLUMNS.length}>
                          <KeyPanel asset={asset} onChanged={onAssetChanged} />
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
  );
}
