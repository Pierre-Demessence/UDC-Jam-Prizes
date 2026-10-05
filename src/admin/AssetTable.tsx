import { Fragment, useState } from 'react';

import type { Sort, SortKey } from '@/admin/asset-table';

import { COLUMNS, DEFAULT_SORT, keySummary, nextSort, sortAssets } from '@/admin/asset-table';
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
  onToggleKeys: (id: number) => void;
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
  onToggleKeys,
  openKeys,
}: AssetTableProps) {
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const rows = sortAssets(assets, sort);

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
          {rows.map(asset => (
            <Fragment key={asset.id}>
              <tr>
                <th className="cell-name" scope="row">
                  <a href={asset.assetUrl} rel="noreferrer" target="_blank">{asset.name}</a>
                </th>
                <td>{asset.publisher ?? <span className="muted">unknown</span>}</td>
                <td>{formatCategory(asset.category) ?? <span className="muted">uncategorised</span>}</td>
                <td className="cell-number" title="Read from the Asset Store page; edit it if it is wrong.">
                  {formatPrice(asset.priceCents, asset.currency)}
                </td>
                <td className="cell-number" title={keySummary(asset)}>
                  {asset.keys.length}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
