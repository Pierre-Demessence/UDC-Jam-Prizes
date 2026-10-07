import type { CategoryNode } from '@/category-tree';

import { countInCategory } from '@/category-tree';
import { CheckIcon, ChevronRightIcon } from '@/gallery/icons';

interface CategoryTreeProps {
  /** The categories of the prizes that match the search: what the counts add up. */
  categories: (string | null)[];
  nodes: CategoryNode[];
  /** Paths of the nodes whose children are showing. */
  open: ReadonlySet<string>;
  /** The picked path; the empty string is "All categories". */
  selected: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

const INDENT_PX = 16;

const ALL_CATEGORIES: CategoryNode = { children: [], label: 'All categories', path: '' };

function Row({ depth, node, tree }: { depth: number; node: CategoryNode; tree: CategoryTreeProps }) {
  const { categories, onSelect, onToggle, open, selected } = tree;
  const isSelected = selected === node.path;
  const isOpen = open.has(node.path);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div className={isSelected ? 'tree-row is-selected' : 'tree-row'} style={{ paddingInlineStart: depth * INDENT_PX }}>
        {hasChildren
          ? (
              <button
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Hide' : 'Show'} the ${node.label} subcategories`}
                className="tree-toggle"
                onClick={() => onToggle(node.path)}
                type="button"
              >
                <ChevronRightIcon size={13} />
              </button>
            )
          : <span className="tree-spacer" />}
        <button
          aria-current={isSelected ? 'true' : undefined}
          className="tree-pick"
          onClick={() => onSelect(node.path)}
          type="button"
        >
          <span>{node.label}</span>
          <span className="tree-meta">
            <span className="tree-count">{countInCategory(categories, node.path)}</span>
            {isSelected ? <CheckIcon size={13} /> : null}
          </span>
        </button>
      </div>
      {hasChildren && isOpen
        ? (
            <ul>
              {node.children.map(child => <Row depth={depth + 1} key={child.path} node={child} tree={tree} />)}
            </ul>
          )
        : null}
    </li>
  );
}

export function CategoryTree(props: CategoryTreeProps) {
  return (
    <nav aria-label="Categories" className="tree">
      <ul>
        <Row depth={0} node={ALL_CATEGORIES} tree={props} />
        {props.nodes.map(node => <Row depth={0} key={node.path} node={node} tree={props} />)}
      </ul>
    </nav>
  );
}
