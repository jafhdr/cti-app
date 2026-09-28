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
  Crosshair,
  Radio,
  Shield,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Radar,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { applyTheme, type ThemePreference } from '../ThemeProvider';
import type { ModuleAccess } from '../../lib/module-access';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly aliases?: readonly string[];
  readonly matchDescendants?: boolean;
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

const caseManagementItems: readonly NavigationItem[] = [
  { label: 'Cases', href: '/cases', icon: ClipboardList, matchDescendants: true },
];

const attackSurfaceItems: readonly NavigationItem[] = [
  { label: 'Assets', href: '/attack-surface/assets', icon: Radar, matchDescendants: true },
];

const threatIntelligenceItems: readonly NavigationItem[] = [
  { label: 'Overview', href: '/threat-intelligence', icon: Shield },
  { label: 'Indicators', href: '/threat-intelligence/indicators', icon: Radar, aliases: ['/indicators'] },
  { label: 'Threat Actors', href: '/intelligence/threat-actors', icon: Bot, aliases: ['/threat-intelligence/threat-actors'] },
  { label: 'Campaigns', href: '/threat-intelligence/campaigns', icon: Network },
  { label: 'MITRE ATT&CK', href: '/threat-intelligence/mitre-attack', icon: Crosshair },
  { label: 'Malware & Tools', href: '/threat-intelligence/malware-tools', icon: Bug },
  { label: 'Vulnerabilities', href: '/threat-intelligence/vulnerabilities', icon: ShieldAlert },
  { label: 'Intelligence Reports', href: '/threat-intelligence/reports', icon: FileText },
  { label: 'Sources', href: '/intelligence/sources', icon: BookOpen, aliases: ['/threat-intelligence/sources'] },
  { label: 'Feeds', href: '/threat-intelligence/feeds', icon: Radio },
  { label: 'Intelligence Hub', href: '/threat-intelligence/hub', icon: GitFork, aliases: ['/intelligence'] },
];

export default function Sidebar({
  role,
  onLogout,
  moduleAccess = [],
}: SidebarProps) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<ThemePreference>('dark');
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeModuleId = pathname.startsWith('/threat-intelligence') || pathname === '/indicators' || pathname.startsWith('/intelligence')
    ? 'threat-intelligence'
    : pathname === '/cases' || pathname.startsWith('/cases/')
      ? 'case-management'
    : pathname.startsWith('/attack-surface')
      ? 'attack-surface-management'
    : administrationItemsForRole(role).some(item => isItemActive(item, pathname))
      ? 'administration'
      : null;
  const [expandedModules, setExpandedModules] = useState<Readonly<Record<string, boolean>>>(() => activeModuleId ? { [activeModuleId]: true } : {});

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('cti-theme');
    setTheme(savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark');
  }, []);

  useEffect(() => {
    if (!activeModuleId) return;
    setExpandedModules(current => current[activeModuleId] ? current : { ...current, [activeModuleId]: true });
  }, [activeModuleId]);

  function changeTheme(value: ThemePreference) {
    window.localStorage.setItem('cti-theme', value);
    applyTheme(value);
    setTheme(value);
  }

  const canAccessThreatIntelligence = moduleAccess.some(module => module.accessible === true && module.moduleSlug === 'threat-intelligence');
  const catalogModules: readonly NavigationModule[] = moduleAccess
    .filter(module => module.moduleSlug !== 'threat-intelligence' && module.accessible === true)
    .map(module => ({
      id: module.moduleSlug,
      label: module.moduleName,
      items: module.moduleSlug === 'case-management' ? caseManagementItems : module.moduleSlug === 'attack-surface-management' ? attackSurfaceItems : [],
    }));
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
      <button type="button" className="sidebar-mobile-toggle" aria-expanded={mobileOpen} aria-controls="sidebar-navigation" onClick={() => setMobileOpen(open => !open)}>Menu navigasi</button>
      <Link
        href="/dashboard"
        className="brand"
        aria-label="CTI Platform dashboard"
      >
        <Activity size={19} aria-hidden="true" />
        <span>CTI Platform</span>
      </Link>

      <nav id="sidebar-navigation" className={`sidebar-navigation${mobileOpen ? ' is-open' : ''}`} aria-label="Navigasi utama" onClick={() => setMobileOpen(false)}>
        <NavigationLink item={dashboardItem} pathname={pathname} />
        {modules.map(module => <ModuleSection expanded={expandedModules[module.id] ?? false} key={module.id} module={module} pathname={pathname} onToggle={toggleModule} />)}
      </nav>

      <div className="sidebar-footer">
        <label className="theme-select-label" htmlFor="cti-theme">Tema</label>
        <select id="cti-theme" className="theme-select" value={theme} onChange={event => changeTheme(event.target.value as ThemePreference)}>
          <option value="dark">Gelap</option><option value="light">Terang</option><option value="system">Sistem</option>
        </select>
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

function isItemActive(item: NavigationItem, pathname: string): boolean {
  return pathname === item.href
    || (item.matchDescendants === true && pathname.startsWith(`${item.href}/`))
    || (item.aliases?.includes(pathname) ?? false);
}

function administrationItemsForRole(role?: Role): readonly NavigationItem[] {
  if (role === 'SUPER_ADMIN') return [{ label: 'Tenant Management', href: '/tenants', icon: Building2 }, { label: 'User Management', href: '/users', icon: Users }, { label: 'Akses Modul', href: '/module-access', icon: KeyRound }, { label: 'Module Management', href: '/modules', icon: ShieldAlert }, { label: 'Subscription', href: '/subscription', icon: CreditCard }, { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList }];
  if (role === 'ADMIN') return [{ label: 'User Management', href: '/users', icon: Users }, { label: 'Akses Modul', href: '/module-access', icon: KeyRound }, { label: 'Module Management', href: '/modules', icon: ShieldAlert }, { label: 'Subscription', href: '/subscription', icon: CreditCard }, { label: 'Audit Log', href: '/audit-logs', icon: ClipboardList }];
  return [];
}

function moduleOrder(id: string): number {
  const order: Readonly<Record<string, number>> = { 'case-management': 10, 'threat-intelligence': 20, 'attack-surface-management': 30, 'appsec-posture': 40, administration: 100 };
  return order[id] ?? 50;
}
