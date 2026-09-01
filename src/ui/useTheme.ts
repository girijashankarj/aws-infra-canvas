import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'iac-diagram:theme';

const readStored = (): ThemeChoice => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    // Private windows and blocked site data both throw here; the default is fine.
    return 'system';
  }
};

/** Resolves the three-state preference against the OS setting. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const dark = choice === 'system' ? systemDark : choice === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // Persisting the preference is a convenience, not a requirement.
    }
  }, [choice]);

  const toggle = useCallback(() => setChoice(dark ? 'light' : 'dark'), [dark]);

  return { dark, choice, setChoice, toggle };
}
