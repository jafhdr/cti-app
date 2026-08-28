'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type MenuItem = {
  label: string;
  href: string;
  divider?: boolean;
};

interface SidebarProps {
  role?: Role;
  onLogout?: () => void;
}

export default function Sidebar({ role, onLogout }: SidebarProps) {
  const pathname = usePathname();

  const baseItems: MenuItem[] = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Indicators', href: '/indicators' },
    { label: 'Threat Actors', href: '#' },
    { label: 'Campaigns', href: '#' },
    { label: 'Cases', href: '#' },
    { label: 'Reports', href: '#' },
    { label: 'Sources', href: '#' },
    { label: 'Alerts', href: '#' },
  ];

  const adminItems: MenuItem[] =
    role === 'SUPER_ADMIN'
      ? [
          { label: 'ADMIN', href: '', divider: true },
          { label: '🏢 Tenant Management', href: '/tenants' },
          { label: '👥 User Management', href: '/users' },
          { label: '📋 Audit Log', href: '/audit-logs' },
        ]
      : role === 'ADMIN'
      ? [
          { label: 'ADMIN', href: '', divider: true },
          { label: '👥 User Management', href: '/users' },
          { label: '📋 Audit Log', href: '/audit-logs' },
        ]
      : [];

  const allItems = [...baseItems, ...adminItems];

  return (
    <aside className="sidebar">
      <div className="brand">CTI Platform</div>
      <nav className="nav">
        {allItems.map((item) =>
          item.divider ? (
            <div
              key={item.label}
              style={{
                fontSize: 10,
                color: '#64748b',
                padding: '10px 12px 2px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {item.label}
            </div>
          ) : (
            <Link
              key={item.label}
              href={item.href}
              className={`nav-item${pathname === item.href ? ' active' : ''}`}
            >
              {item.label}
            </Link>
          )
        )}
      </nav>
      {onLogout && (
        <button
          onClick={onLogout}
          className="logout"
          style={{ marginTop: 20, width: '100%', textAlign: 'center' }}
        >
          Logout
        </button>
      )}
    </aside>
  );
}
