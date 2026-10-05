import antfu from '@antfu/eslint-config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';

const topIdAndName = {
  groups: ['top', 'member', 'multiline-member', 'unknown', 'method', 'multiline-method'],
  partitionByComment: true,
  customGroups: [
    {
      elementNamePattern: '^(?:id|name)$',
      groupName: 'top',
      selector: 'property' as const,
    },
  ],
};

export default antfu(
  {
    ignores: ['dist/**', 'coverage/**', 'docs/**', 'data/**', 'drizzle/**'],
    markdown: false,
    react: true,
    type: 'app',
    typescript: true,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: true,
    },
  },
  {
    // Registered as `import-x` because antfu already owns the `import` prefix.
    plugins: {
      'import-x': importX,
    },
    rules: {
      'import-x/no-unresolved': 'error',
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
  },
  {
    rules: {
      'perfectionist/sort-array-includes': ['warn', { partitionByComment: true }],
      'perfectionist/sort-imports': ['error', { partitionByComment: true }],
      'perfectionist/sort-interfaces': ['error', { ...topIdAndName, type: 'natural' }],
      'perfectionist/sort-objects': ['error', { ...topIdAndName, order: 'asc', type: 'alphabetical' }],
    },
  },
);
