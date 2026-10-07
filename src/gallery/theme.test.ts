import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEME, parseTheme, readTheme, saveTheme, THEME_STORAGE_KEY } from '@/gallery/theme';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('parseTheme', () => {
  it('accepts the three known themes', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
  });

  it('falls back to the system theme for anything else', () => {
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme('sepia')).toBe(DEFAULT_THEME);
  });
});

describe('the stored theme', () => {
  it('is remembered', () => {
    saveTheme('dark');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readTheme()).toBe('dark');
  });

  it('defaults to the system theme when nothing was saved', () => {
    expect(readTheme()).toBe('system');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readTheme()).toBe('system');
    expect(() => saveTheme('light')).not.toThrow();
  });
});
