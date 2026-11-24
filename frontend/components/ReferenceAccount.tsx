'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { DashboardBell } from './dashboard/DashboardBell';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Props = {
  readonly email: string;
  readonly role: Role;
  readonly tenantId: string;
  readonly tenantSelector?: ReactNode;
  readonly onLogout: () => Promise<void>;
};

export function ReferenceAccount({ email, role, tenantId, tenantSelector, onLogout }: Props) {
  const name = role === 'SUPER_ADMIN' ? 'Super Admin' : role === 'ADMIN' ? 'Admin' : 'Analyst';
  const initials = role === 'SUPER_ADMIN' ? 'SA' : role === 'ADMIN' ? 'AD' : 'AN';
  function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>): void {
    if (event.key === 'Escape') event.currentTarget.open = false;
  }
  return <div className="ux-account-area">
    {tenantSelector}
    <DashboardBell role={role} tenantId={tenantId} />
    <span className="ux-account-divider" aria-hidden="true" />
    <details className="ux-account" onKeyDown={closeOnEscape}>
      <summary aria-label={`${name} account menu`}><span className="ux-avatar" aria-hidden="true">{initials}</span><span className="ux-account-copy"><strong>{name}</strong><small>{email}</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
      <div className="ux-account-menu"><button type="button" onClick={() => void onLogout()}><LogOut size={16} aria-hidden="true" /> Sign out</button></div>
    </details>
  </div>;
}
