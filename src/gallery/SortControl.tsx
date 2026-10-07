import type { SortKey } from '@/catalogue';

import { SORT_LABELS } from '@/catalogue';

interface SortControlProps {
  sort: SortKey;
  onChange: (sort: SortKey) => void;
}

const KEYS = Object.keys(SORT_LABELS) as SortKey[];

/**
 * Two ways to the same choice: a labelled toggle on a wide screen, a select on a
 * narrow one. CSS shows one of them.
 */
export function SortControl({ onChange, sort }: SortControlProps) {
  return (
    <div className="sort">
      <span className="sort-label">Sort by</span>
      <div aria-label="Sort by" className="segmented sort-toggle" role="group">
        {KEYS.map(key => (
          <button aria-pressed={sort === key} className="segment" key={key} onClick={() => onChange(key)} type="button">
            {SORT_LABELS[key]}
          </button>
        ))}
      </div>
      <select aria-label="Sort by" className="sort-select" onChange={event => onChange(event.target.value as SortKey)} value={sort}>
        {KEYS.map(key => <option key={key} value={key}>{`Sort: ${SORT_LABELS[key]}`}</option>)}
      </select>
    </div>
  );
}
