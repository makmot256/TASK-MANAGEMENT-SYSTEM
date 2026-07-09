import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeCtx {
  theme: ThemeMode;
  resolved: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'tms_theme';
const Ctx = createContext<ThemeCtx>({
  theme: 'light',
  resolved: 'light',
  setTheme: () => {},
  toggle: () => {},
});

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function readStored(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStored);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStored()));

  useEffect(() => {
    const apply = () => {
      const next = resolve(theme);
      setResolved(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      localStorage.setItem(STORAGE_KEY, theme);
    };
    apply();

    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (mode: ThemeMode) => setThemeState(mode);
  const toggle = () => setThemeState((t) => (resolve(t) === 'light' ? 'dark' : 'light'));

  return (
    <Ctx.Provider value={{ theme, resolved, setTheme, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
