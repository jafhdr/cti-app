import type { ReactNode } from 'react';
import { AppSecShell } from '@/components/appsec/AppSecShell';
import './appsec-reference.css';

export default function AppSecLayout({ children }: { readonly children: ReactNode }) {
  return <AppSecShell>{children}</AppSecShell>;
}
