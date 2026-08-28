'use client';

import { ThemeProvider } from '@gravity-ui/uikit';

export default function GravityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider theme="light">
      {children}
    </ThemeProvider>
  );
}