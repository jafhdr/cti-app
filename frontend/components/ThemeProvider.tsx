'use client';

import { useEffect } from 'react';

export type ThemePreference = 'dark' | 'light' | 'system';

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    const stored = window.localStorage.getItem('cti-theme');
    const preference: ThemePreference = stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'dark';
    applyTheme(preference);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      if ((window.localStorage.getItem('cti-theme') ?? 'dark') === 'system') applyTheme('system');
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return children;
}
