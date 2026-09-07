'use client';

import {
  Activity,
  Building2,
  ClipboardList,
  CreditCard,
  GitFork,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Moon,
  Radar,
  ShieldAlert,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ModuleAccess } from '../../lib/module-access';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
};

type SidebarProps = {
  readonly role?: Role;
  readonly onLogout?: () => void;
  readonly moduleAccess?: readonly ModuleAccess[];
};

// Items yang selalu tampil untuk semua role
const coreItems: readonly NavigationItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Indicators', href: '/indicators', icon: Radar },
];

// Mapping modul ke halaman yang tersedia (tambah baris baru saat halaman dibuat)
const modulePageMap: Record<string, { href: string; icon: LucideIcon }> = {
  'threat-intelligence': { href: '/intelligence', icon: GitFork },
};

export default function Sidebar({
  role,
  onLogout,
  moduleAccess = [],
}: SidebarProps) {
  const pathname = usePathname();
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('cti-theme');
    const shouldUseDarkMode =
      savedTheme === 'dark' ||
      (savedTheme === null &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', shouldUseDarkMode);
    setDarkMode(shouldUseDarkMode);
  }, []);

  function toggleTheme() {
    const nextDarkMode = !darkMode;
    document.documentElement.classList.toggle('dark', nextDarkMode);
    window.localStorage.setItem('cti-theme', nextDarkMode ? 'dark' : 'light');
    setDarkMode(nextDarkMode);
  }

  // Buat daftar item intelligence section
  const intelligenceItems: readonly NavigationItem[] = (() => {
    // Untuk SUPER_ADMIN dan ADMIN: tampilkan semua item original
    if (role !== 'USER') {
      return [
        ...coreItems,
        { label: 'Intelligence Hub', href: '/intelligence', icon: GitFork },
      ];
    }

    // Untuk USER: tampilkan core items + modul yang diizinkan
    const items: NavigationItem[] = [...coreItems];

    // Tambah modul lain dari moduleAccess yang punya halaman
    for (const mod of moduleAccess) {
      if (!mod.assigned) continue;
      const page = modulePageMap[mod.moduleSlug];
      if (page) {
        items.push({ label: mod.moduleName, href: page.href, icon: page.icon });
      }
    }

    return items;
  })();

  const administrationItems: readonly NavigationItem[] =
    role === 'SUPER_ADMIN'
      ? [
          { label: 'Tenant Management', href: '/tenants', icon: Building2 },
          { label: 'User Management', href: '/users', icon: Users },
          { label: 'Akses Modul', href: '/module-access', icon: KeyRound },
          { label: 'Module Management', href: '/modules', icon: ShieldAlert },
          { label: 'Subscription', href: '/subscription', icon: CreditCard },
          { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList },
        ]
      : role === 'ADMIN'
        ? [
            { label: 'User Management', href: '/users', icon: Users },
            { label: 'Akses Modul', href: '/module-access', icon: KeyRound },
            { label: 'Module Management', href: '/modules', icon: ShieldAlert },
            { label: 'Subscription', href: '/subscription', icon: CreditCard },
            { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList },
          ]
        : [];

  return (
    <aside className="sidebar">
      <Link
        href="/dashboard"
        className="brand"
        aria-label="CTI Platform dashboard"
      >
        <Activity size={19} aria-hidden="true" />
        <span>CTI Platform</span>
      </Link>

      <nav className="sidebar-navigation" aria-label="Navigasi utama">
        <div className="sidebar-group">
          <p className="sidebar-group-label">Intelligence</p>
          {intelligenceItems.map((item) => (
            <NavigationLink
              item={item}
              key={item.href}
              pathname={pathname}
            />
          ))}
        </div>

        {administrationItems.length > 0 && (
          <div className="sidebar-group">
            <p className="sidebar-group-label">Administration</p>
            {administrationItems.map((item) => (
              <NavigationLink
                item={item}
                key={item.href}
                pathname={pathname}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={
            darkMode ? 'Gunakan mode terang' : 'Gunakan mode gelap'
          }
        >
          {darkMode ? (
            <Sun size={16} aria-hidden="true" />
          ) : (
            <Moon size={16} aria-hidden="true" />
          )}
          <span>{darkMode ? 'Mode terang' : 'Mode gelap'}</span>
        </button>
        {onLogout && (
          <button className="logout" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" />
            Keluar
          </button>
        )}
      </div>
    </aside>
  );
}

function NavigationLink({
  item,
  pathname,
}: {
  readonly item: NavigationItem;
  readonly pathname: string;
}) {
  const Icon = item.icon;
  const isActive = pathname === item.href;
  return (
    <Link
      href={item.href}
      className={`sidebar-link${isActive ? ' active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}
