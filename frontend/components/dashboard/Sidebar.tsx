'use client';

import { Activity, Building2, ClipboardList, GitFork, LayoutDashboard, LogOut, Moon, Radar, ShieldAlert, Sun, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
};

type SidebarProps = {
  readonly role?: Role;
  readonly onLogout?: () => void;
};

const intelligenceItems: readonly NavigationItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Indicators', href: '/indicators', icon: Radar },
  { label: 'Intelligence Hub', href: '/intelligence', icon: GitFork },
];

export default function Sidebar({ role, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    const savedTheme = window.localStorage.getItem('cti-theme');
    const shouldUseDarkMode = savedTheme === 'dark' || (savedTheme === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', shouldUseDarkMode);
    setDarkMode(shouldUseDarkMode);
  }, []);
  function toggleTheme() {
    const nextDarkMode = !darkMode;
    document.documentElement.classList.toggle('dark', nextDarkMode);
    window.localStorage.setItem('cti-theme', nextDarkMode ? 'dark' : 'light');
    setDarkMode(nextDarkMode);
  }
  const administrationItems: readonly NavigationItem[] = role === 'SUPER_ADMIN'
    ? [
      { label: 'Tenant Management', href: '/tenants', icon: Building2 },
      { label: 'User Management', href: '/users', icon: Users },
      { label: 'Module Management', href: '/modules', icon: ShieldAlert },
      { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList },
    ]
    : role === 'ADMIN'
      ? [
        { label: 'User Management', href: '/users', icon: Users },
        { label: 'Module Management', href: '/modules', icon: ShieldAlert },
        { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList },
      ]
      : [];

  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="CTI Platform dashboard"><Activity size={19} aria-hidden="true" /><span>CTI Platform</span></Link>
      <nav className="sidebar-navigation" aria-label="Navigasi utama">
        <div className="sidebar-group">
          <p className="sidebar-group-label">Intelligence</p>
          {intelligenceItems.map((item) => <NavigationLink item={item} key={item.href} pathname={pathname} />)}
        </div>
        {administrationItems.length > 0 && <div className="sidebar-group">
          <p className="sidebar-group-label">Administration</p>
          {administrationItems.map((item) => <NavigationLink item={item} key={item.href} pathname={pathname} />)}
        </div>}
      </nav>
      <div className="sidebar-footer">
        <button className="theme-toggle" onClick={toggleTheme} aria-label={darkMode ? 'Gunakan mode terang' : 'Gunakan mode gelap'}>{darkMode ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}<span>{darkMode ? 'Mode terang' : 'Mode gelap'}</span></button>
        {onLogout && <button className="logout" onClick={onLogout}><LogOut size={16} aria-hidden="true" />Keluar</button>}
      </div>
    </aside>
  );
}

function NavigationLink({ item, pathname }: { readonly item: NavigationItem; readonly pathname: string }) {
  const Icon = item.icon;
  const isActive = pathname === item.href;
  return <Link href={item.href} className={`sidebar-link${isActive ? ' active' : ''}`} aria-current={isActive ? 'page' : undefined}><Icon size={17} aria-hidden="true" /><span>{item.label}</span></Link>;
}
