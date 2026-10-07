import { formatCategory } from '@/format';

/**
 * The category is the Asset Store path (`3d/characters/humanoids`). The gallery
 * shows it as a tree, and picking a node means "this category and everything
 * below it". Pure, so it is testable.
 */

export interface CategoryNode {
  children: CategoryNode[];
  label: string;
  /** The normalised stored path up to and including this node. */
  path: string;
}

/** Stored paths may carry stray slashes and spaces; every comparison goes through this. */
function segmentsOf(category: string | null): string[] {
  return (category ?? '')
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment !== '');
}

interface DraftNode {
  children: Map<string, DraftNode>;
  label: string;
  path: string;
}

function finish(drafts: Map<string, DraftNode>): CategoryNode[] {
  return [...drafts.values()]
    .map(draft => ({ children: finish(draft.children), label: draft.label, path: draft.path }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** A parent that only exists as the start of a deeper path still gets its own node. */
export function buildCategoryTree(categories: (string | null)[]): CategoryNode[] {
  const roots = new Map<string, DraftNode>();

  for (const category of categories) {
    let level = roots;
    const walked: string[] = [];

    for (const segment of segmentsOf(category)) {
      walked.push(segment);
      let node = level.get(segment);
      if (node === undefined) {
        node = { children: new Map(), label: formatCategory(segment) ?? segment, path: walked.join('/') };
        level.set(segment, node);
      }
      level = node.children;
    }
  }

  return finish(roots);
}

/** Whole segments, so `3d` does not claim `3d-tools`; the empty path claims everything. */
export function inCategory(category: string | null, path: string): boolean {
  if (path === '')
    return true;

  return `${segmentsOf(category).join('/')}/`.startsWith(`${path}/`);
}

export function countInCategory(categories: (string | null)[], path: string): number {
  return categories.filter(category => inCategory(category, path)).length;
}

/** The parent paths of a node, nearest the root first: what has to be open to show it. */
export function ancestorsOf(path: string): string[] {
  const segments = segmentsOf(path);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}
