import { describe, expect, it } from 'vitest';

import { ancestorsOf, buildCategoryTree, countInCategory, inCategory } from '@/category-tree';

const categories = [
  '3d/environments/nature',
  '3d/characters/humanoids',
  '3d/characters/creatures',
  '3d/props',
  'tools/gui',
  'tools',
  null,
  '',
];

describe('buildCategoryTree', () => {
  it('nests the stored paths and labels each segment readably', () => {
    const tree = buildCategoryTree(categories);

    expect(tree.map(node => node.label)).toEqual(['3D', 'Tools']);
    const threeD = tree[0]!;
    expect(threeD.path).toBe('3d');
    expect(threeD.children.map(node => node.label)).toEqual(['Characters', 'Environments', 'Props']);
    expect(threeD.children[0]!.children.map(node => node.path)).toEqual(['3d/characters/creatures', '3d/characters/humanoids']);
  });

  it('makes a node for a parent that only exists as a prefix', () => {
    const tree = buildCategoryTree(['tools/gui']);

    expect(tree.map(node => node.path)).toEqual(['tools']);
    expect(tree[0]!.children.map(node => node.path)).toEqual(['tools/gui']);
  });

  it('ignores prizes without a category', () => {
    expect(buildCategoryTree([null, '', ' / '])).toEqual([]);
  });

  it('tolerates stray slashes and spaces', () => {
    expect(buildCategoryTree([' /tools/ gui/']).map(node => node.path)).toEqual(['tools']);
  });
});

describe('inCategory', () => {
  it('matches everything for the empty path', () => {
    expect(inCategory(null, '')).toBe(true);
    expect(inCategory('tools', '')).toBe(true);
  });

  it('matches the category itself and everything below it', () => {
    expect(inCategory('3d/characters/humanoids', '3d')).toBe(true);
    expect(inCategory('3d/characters/humanoids', '3d/characters')).toBe(true);
    expect(inCategory('3d/characters', '3d/characters')).toBe(true);
  });

  it('compares whole segments, not prefixes of text', () => {
    expect(inCategory('3d-tools', '3d')).toBe(false);
    expect(inCategory('3d/props', '3d/pro')).toBe(false);
  });

  it('never matches a prize without a category once a category is picked', () => {
    expect(inCategory(null, 'tools')).toBe(false);
    expect(inCategory('', 'tools')).toBe(false);
  });
});

describe('countInCategory', () => {
  it('counts the subtree', () => {
    expect(countInCategory(categories, '3d')).toBe(4);
    expect(countInCategory(categories, '3d/characters')).toBe(2);
    expect(countInCategory(categories, '')).toBe(categories.length);
  });
});

describe('ancestorsOf', () => {
  it('lists every parent path, nearest the root first', () => {
    expect(ancestorsOf('3d/characters/humanoids')).toEqual(['3d', '3d/characters']);
  });

  it('has none for a root or the empty path', () => {
    expect(ancestorsOf('tools')).toEqual([]);
    expect(ancestorsOf('')).toEqual([]);
  });
});
