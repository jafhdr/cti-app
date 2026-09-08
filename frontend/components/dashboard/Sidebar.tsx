'use client';

import {
  Activity,
  Building2,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  CreditCard,
  GitFork,
  BookOpen,
  Bot,
  Bug,
  FileText,
  Network,
  Radio,
  Shield,
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
  readonly aliases?: readonly string[];
};

type NavigationModule = {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavigationItem[];
};

type SidebarProps = {
  readonly role?: Role;
  readonly onLogout?: () => void;
  readonly moduleAccess?: readonly ModuleAccess[];
};

// Items yang selalu tampil untuk semua role
const dashboardItem: NavigationItem = { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard };

const threatIntelligenceItems: readonly NavigationItem[] = [
  { label: 'Overview', href: '/threat-intelligence', icon: Shield },
  { label: 'Indicators', href: '/threat-intelligence/indicators', icon: Radar, aliases: ['/indicators'] },
  { label: 'Threat Actors', href: '/threat-intelligence/threat-actors', icon: Bot },
  { label: 'Campaigns', href: '/threat-intelligence/campaigns', icon: Network },
  { label: 'Malware & Tools', href: '/threat-intelligence/malware-tools', icon: Bug },
  { label: 'Vulnerabilities', href: '/threat-intelligence/vulnerabilities', icon: ShieldAlert },
  { label: 'Intelligence Reports', href: '/threat-intelligence/reports', icon: FileText },
  { label: 'Sources', href: '/threat-intelligence/sources', icon: BookOpen },
  { label: 'Feeds', href: '/threat-intelligence/feeds', icon: Radio },
  { label: 'Intelligence Hub', href: '/threat-intelligence/hub', icon: GitFork, aliases: ['/intelligence'] },
];

export default function Sidebar({
  role,
  onLogout,
  moduleAccess = [],
}: SidebarProps) {
  const pathname = usePathname();
  const [darkMode, setDarkMode] = useState(false);
  const activeModuleId = pathname.startsWith('/threat-intelligence') || pathname === '/indicators' || pathname === '/intelligence'
    ? 'threat-intelligence'
    : administrationItemsForRole(role).some(item => isItemActive(item, pathname))
      ? 'administration'
      : null;
  const [expandedModules, setExpandedModules] = useState<Readonly<Record<string, boolean>>>(() => activeModuleId ? { [activeModuleId]: true } : {});

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('cti-theme');
    const shouldUseDarkMode =
      savedTheme === 'dark' ||
      (savedTheme === null &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', shouldUseDarkMode);
    setDarkMode(shouldUseDarkMode);
  }, []);

  useEffect(() => {
    if (!activeModuleId) return;
    setExpandedModules(current => current[activeModuleId] ? current : { ...current, [activeModuleId]: true });
  }, [activeModuleId]);

  function toggleTheme() {
    const nextDarkMode = !darkMode;
    document.documentElement.classList.toggle('dark', nextDarkMode);
    window.localStorage.setItem('cti-theme', nextDarkMode ? 'dark' : 'light');
    setDarkMode(nextDarkMode);
  }

  const canAccessThreatIntelligence = role === 'SUPER_ADMIN' || role === 'ADMIN' || moduleAccess.some(module => module.assigned && module.moduleSlug === 'threat-intelligence');
  const catalogModules: readonly NavigationModule[] = moduleAccess
    .filter(module => module.moduleSlug !== 'threat-intelligence' && (role === 'SUPER_ADMIN' || module.assigned))
    .map(module => ({ id: module.moduleSlug, label: module.moduleName, items: [] }));
  const modules: readonly NavigationModule[] = [
    ...catalogModules,
    ...(canAccessThreatIntelligence ? [{ id: 'threat-intelligence', label: 'Threat Intelligence', items: threatIntelligenceItems }] : []),
    ...(administrationItemsForRole(role).length > 0 ? [{ id: 'administration', label: 'Administration', items: administrationItemsForRole(role) }] : []),
  ].sort((left, right) => moduleOrder(left.id) - moduleOrder(right.id));

  function toggleModule(id: string): void {
    setExpandedModules(current => ({ ...current, [id]: !current[id] }));
  }

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
        <NavigationLink item={dashboardItem} pathname={pathname} />
        {modules.map(module => <ModuleSection expanded={expandedModules[module.id] ?? false} key={module.id} module={module} pathname={pathname} onToggle={toggleModule} />)}
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

function ModuleSection({ expanded, module, pathname, onToggle }: { readonly expanded: boolean; readonly module: NavigationModule; readonly pathname: string; readonly onToggle: (id: string) => void }) {
  const submenuId = `sidebar-module-${module.id}`;
  return <section className={`sidebar-module${module.items.some(item => isItemActive(item, pathname)) ? ' active' : ''}`}><button type="button" className="sidebar-module-toggle" aria-controls={submenuId} aria-expanded={expanded} onClick={() => onToggle(module.id)}><span>{module.label}</span>{expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</button>{expanded && <div className="sidebar-submenu" id={submenuId}>{module.items.length > 0 ? module.items.map(item => <NavigationLink item={item} key={item.href} pathname={pathname} />) : <span className="sidebar-empty-submenu">Belum ada halaman</span>}</div>}</section>;
}

function NavigationLink({
  item,
  pathname,
}: {
  readonly item: NavigationItem;
  readonly pathname: string;
}) {
  const Icon = item.icon;
  const isActive = isItemActive(item, pathname);
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

function isItemActive(item: NavigationItem, pathname: string): boolean { return pathname === item.href || (item.aliases?.includes(pathname) ?? false); }

function administrationItemsForRole(role?: Role): readonly NavigationItem[] {
  if (role === 'SUPER_ADMIN') return [{ label: 'Tenant Management', href: '/tenants', icon: Building2 }, { label: 'User Management', href: '/users', icon: Users }, { label: 'Akses Modul', href: '/module-access', icon: KeyRound }, { label: 'Module Management', href: '/modules', icon: ShieldAlert }, { label: 'Subscription', href: '/subscription', icon: CreditCard }, { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList }];
  if (role === 'ADMIN') return [{ label: 'User Management', href: '/users', icon: Users }, { label: 'Akses Modul', href: '/module-access', icon: KeyRound }, { label: 'Module Management', href: '/modules', icon: ShieldAlert }, { label: 'Subscription', href: '/subscription', icon: CreditCard }, { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList }];
  return [];
}

function moduleOrder(id: string): number {
  const order: Readonly<Record<string, number>> = { 'case-management': 10, 'threat-intelligence': 20, 'appsec-posture': 30, administration: 100 };
  return order[id] ?? 50;
}
