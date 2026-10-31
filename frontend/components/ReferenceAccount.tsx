'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { DashboardBell } from './dashboard/DashboardBell';

type ReferenceAccountProps = {
  readonly email: string;
  readonly role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  readonly onLogout: () => Promise<void>;
  readonly tenantSelector?: ReactNode;
  readonly tenantId: string;
};

export function ReferenceAccount({ email, role, onLogout, tenantSelector, tenantId }: ReferenceAccountProps) {
  const name = role === 'SUPER_ADMIN' ? 'Super Admin' : role === 'ADMIN' ? 'Admin' : 'Analyst';
  const initials = role === 'SUPER_ADMIN' ? 'SA' : role === 'ADMIN' ? 'AD' : 'AN';
  return <div className="ux-account-area">
    {tenantSelector}
    <DashboardBell role={role} tenantId={tenantId} />
    <span className="ux-account-divider" aria-hidden="true" />
    <details className="ux-account">
      <summary aria-label={`${name} account menu`}><span className="ux-avatar">{initials}</span><span className="ux-account-copy"><strong>{name}</strong><small>{email}</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
      <div className="ux-account-menu"><button type="button" onClick={() => void onLogout()}><LogOut size={16} aria-hidden="true" /> Sign out</button></div>
    </details>
  </div>;
}
