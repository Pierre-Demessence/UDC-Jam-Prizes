import { useCallback, useLayoutEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME: Theme = 'system';

export const THEME_STORAGE_KEY = 'jam-prizes-theme';

export function parseTheme(value: string | null): Theme {
  return THEMES.find(theme => theme === value) ?? DEFAULT_THEME;
}

/** Storage can throw (blocked site data, private windows): the page then just follows the system. */
export function readTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  }
  catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
  catch {
    // The choice then lasts for this visit only.
  }
}

/**
 * The theme lives on `<html data-theme>` so the whole page, the modal dialog's top
 * layer included, inherits it. It is set before paint and removed on unmount, which
 * is what keeps the admin on its own palette.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  const chooseTheme = useCallback((next: Theme) => {
    setTheme(next);
    saveTheme(next);
  }, []);

  return [theme, chooseTheme];
}
