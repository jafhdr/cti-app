'use client';

import {
  Activity,
  Building2,
  BriefcaseBusiness,
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
  Eye,
  Layers3,
  Crosshair,
  Radio,
  Shield,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { applyTheme, type ThemePreference } from '../ThemeProvider';
import type { ModuleAccess } from '../../lib/module-access';
import { isCatalogOnlyModule } from '../../lib/feature-catalog';

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
  readonly dashboardPresentation?: boolean;
};

// Items yang selalu tampil untuk semua role
const dashboardItem: NavigationItem = { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard };

const caseManagementItems: readonly NavigationItem[] = [
  { label: 'Cases', href: '/cases', icon: ClipboardList, matchDescendants: true },
];

const attackSurfaceItems: readonly NavigationItem[] = [
  { label: 'Assets', href: '/attack-surface/assets', icon: Radar, matchDescendants: true },
  ...(process.env.NEXT_PUBLIC_ASM_V2_REVIEW_ENABLED === 'true' ? [{ label: 'Correlation Review', href: '/attack-surface/review', icon: ClipboardList }] : []),
  ...(process.env.NEXT_PUBLIC_ASM_V2_OPERATIONS_ENABLED === 'true' ? [{ label: 'Operations', href: '/attack-surface/operations', icon: Radar }] : []),
  { label: 'Reports', href: '/attack-surface/reports', icon: ClipboardList },
];

const appSecItems: readonly NavigationItem[] = [
  { label: 'Overview', href: '/appsec', icon: Shield },
  { label: 'Applications', href: '/appsec/applications', icon: Shield, matchDescendants: true },
  { label: 'Findings', href: '/appsec/findings', icon: ShieldAlert, matchDescendants: true },
];

const threatIntelligenceItems: readonly NavigationItem[] = [
  { label: 'Overview', href: '/threat-intelligence', icon: Shield },
  { label: 'Indicators', href: '/threat-intelligence/indicators', icon: Radar, aliases: ['/indicators'] },
  { label: 'IOC Candidates', href: '/threat-intelligence/ioc-candidates', icon: Crosshair },
  { label: 'Threat Actors', href: '/intelligence/threat-actors', icon: Bot, aliases: ['/threat-intelligence/threat-actors'] },
  { label: 'Campaigns', href: '/threat-intelligence/campaigns', icon: Network },
  { label: 'Malware & Tools', href: '/threat-intelligence/malware-tools', icon: Bug },
  { label: 'Vulnerabilities', href: '/threat-intelligence/vulnerabilities', icon: ShieldAlert },
  { label: 'Stakeholders', href: '/threat-intelligence/stakeholders', icon: UsersRound },
  { label: 'PIR Management', href: '/threat-intelligence/pirs', icon: ClipboardList },
  { label: 'SIR Management', href: '/threat-intelligence/sirs', icon: ClipboardList },
  { label: 'Collection Planning', href: '/threat-intelligence/collection', icon: ClipboardList },
  { label: 'Intelligence Reports', href: '/threat-intelligence/reports', icon: FileText },
  { label: 'Sources', href: '/intelligence/sources', icon: BookOpen, aliases: ['/threat-intelligence/sources'] },
  { label: 'Threat Feeds', href: '/threat-intelligence/feeds', icon: Radio },
  { label: 'Playbooks', href: '/threat-intelligence/playbooks', icon: ClipboardList },
  { label: 'Monitoring', href: '/threat-intelligence/monitoring', icon: Radar },
  { label: 'MITRE ATT&CK', href: '/threat-intelligence/mitre-attack', icon: Crosshair },
  { label: 'Intelligence Hub', href: '/threat-intelligence/hub', icon: GitFork, aliases: ['/intelligence'] },
];

export default function Sidebar({
  role,
  onLogout,
  moduleAccess = [],
  dashboardPresentation = false,
}: SidebarProps) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<ThemePreference>('dark');
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeModuleId = pathname.startsWith('/threat-intelligence') || pathname === '/indicators' || pathname.startsWith('/intelligence')
    ? 'threat-intelligence'
    : pathname === '/cases' || pathname.startsWith('/cases/')
      ? 'case-management'
    : pathname.startsWith('/attack-surface')
      ? 'attack-surface-management'
    : pathname.startsWith('/appsec')
      ? 'appsec-posture'
    : administrationItemsForRole(role).some(item => isItemActive(item, pathname))
      ? 'administration'
      : null;
  const [expandedModules, setExpandedModules] = useState<Readonly<Record<string, boolean>>>(() => activeModuleId ? { [activeModuleId]: true } : {});

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('cti-theme');
    setTheme(savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark');
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateResolvedTheme = () => setResolvedTheme(savedTheme === 'system' ? (media.matches ? 'dark' : 'light') : savedTheme === 'light' ? 'light' : 'dark');
    updateResolvedTheme();
    media.addEventListener('change', updateResolvedTheme);
    return () => media.removeEventListener('change', updateResolvedTheme);
  }, []);

  useEffect(() => {
    if (!activeModuleId) return;
    setExpandedModules(current => current[activeModuleId] ? current : { ...current, [activeModuleId]: true });
  }, [activeModuleId]);

  function changeTheme(value: ThemePreference) {
    window.localStorage.setItem('cti-theme', value);
    applyTheme(value);
    setTheme(value);
    setResolvedTheme(value === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value);
  }

  const intelligenceAccess = moduleAccess.find(module => module.accessible === true && module.moduleSlug === 'threat-intelligence');
  const canAccessThreatIntelligence = Boolean(intelligenceAccess?.featureKeys.some(key => key === 'indicator-management' || key === 'intelligence-hub'));
  const catalogModules: readonly NavigationModule[] = moduleAccess
    .filter(module => module.moduleSlug !== 'threat-intelligence' && !isCatalogOnlyModule(module.moduleSlug) && module.accessible === true && (module.moduleSlug === 'case-management' ? module.featureKeys.includes('case-workflow') : module.moduleSlug === 'attack-surface-management' ? module.featureKeys.some(key => key === 'asset-management' || key === 'asset-discovery') : module.moduleSlug === 'appsec-posture' ? module.featureKeys.some(key => key === 'application-inventory' || key === 'finding-management' || key === 'posture-overview') : true))
    .map(module => ({
      id: module.moduleSlug,
      label: module.moduleName,
      items: module.moduleSlug === 'case-management' ? caseManagementItems : module.moduleSlug === 'attack-surface-management' ? attackSurfaceItems.filter(() => module.featureKeys.includes('asset-management')) : module.moduleSlug === 'appsec-posture' ? appSecItems.filter(item => module.featureKeys.includes(item.label === 'Overview' ? 'posture-overview' : item.label === 'Applications' ? 'application-inventory' : 'finding-management')) : [],
    }));
  const modules: readonly NavigationModule[] = [
    ...catalogModules,
    ...(canAccessThreatIntelligence ? [{ id: 'threat-intelligence', label: 'Threat Intelligence', items: threatIntelligenceItems.filter(item => ['Overview', 'Indicators', 'IOC Candidates', 'Threat Feeds', 'Playbooks'].includes(item.label) ? intelligenceAccess?.featureKeys.includes('indicator-management') : intelligenceAccess?.featureKeys.includes('intelligence-hub')) }] : []),
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

      <nav id="sidebar-navigation" className={`sidebar-navigation${mobileOpen ? ' is-open' : ''}`} aria-label="Navigasi utama" onClick={event => { if (event.target instanceof Element && event.target.closest('a')) setMobileOpen(false); }}>
        <NavigationLink item={dashboardItem} pathname={pathname} displayLabel={dashboardPresentation ? 'Overview' : undefined} />
        {modules.map(module => <ModuleSection dashboardPresentation={dashboardPresentation} expanded={expandedModules[module.id] ?? false} key={module.id} module={module} pathname={pathname} onToggle={toggleModule} />)}
      </nav>

      <div className="sidebar-footer">
        <span className="theme-select-label" id="cti-theme-label">Tema</span>
        <div className="theme-options" role="group" aria-labelledby="cti-theme-label">
          <button type="button" className={(dashboardPresentation ? resolvedTheme === 'dark' : theme === 'dark') ? 'is-active' : ''} aria-pressed={dashboardPresentation ? resolvedTheme === 'dark' : theme === 'dark'} onClick={() => changeTheme('dark')}><Moon size={16} aria-hidden="true" /> Gelap</button>
          <button type="button" className={(dashboardPresentation ? resolvedTheme === 'light' : theme === 'light') ? 'is-active' : ''} aria-pressed={dashboardPresentation ? resolvedTheme === 'light' : theme === 'light'} onClick={() => changeTheme('light')}><Sun size={16} aria-hidden="true" /> Terang</button>
          {!dashboardPresentation && <button type="button" className={theme === 'system' ? 'is-active' : ''} aria-pressed={theme === 'system'} onClick={() => changeTheme('system')}><Monitor size={16} aria-hidden="true" /> Sistem</button>}
        </div>
        {onLogout && !dashboardPresentation && (
          <button className="logout" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" />
            Keluar
          </button>
        )}
      </div>
    </aside>
  );
}

function ModuleSection({ dashboardPresentation, expanded, module, pathname, onToggle }: { readonly dashboardPresentation: boolean; readonly expanded: boolean; readonly module: NavigationModule; readonly pathname: string; readonly onToggle: (id: string) => void }) {
  const submenuId = `sidebar-module-${module.id}`;
  const Icon = moduleIcons[module.id] ?? Layers3;
  return <section className={`sidebar-module${module.items.some(item => isItemActive(item, pathname)) ? ' active' : ''}`}><button type="button" className="sidebar-module-toggle" aria-controls={submenuId} aria-expanded={expanded} onClick={() => onToggle(module.id)}>{dashboardPresentation && <Icon size={17} aria-hidden="true" />}<span>{module.label}</span>{expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</button>{expanded && <div className="sidebar-submenu" id={submenuId}>{module.items.length > 0 ? module.items.map(item => <NavigationLink item={item} key={item.href} pathname={pathname} />) : <span className="sidebar-empty-submenu">Belum ada halaman</span>}</div>}</section>;
}

const moduleIcons: Readonly<Record<string, LucideIcon>> = {
  'case-management': BriefcaseBusiness,
  'threat-intelligence': Eye,
  'attack-surface-management': Layers3,
  'appsec-posture': ShieldCheck,
  administration: UsersRound,
};

function NavigationLink({
  item,
  pathname,
  displayLabel,
}: {
  readonly item: NavigationItem;
  readonly pathname: string;
  readonly displayLabel?: string;
}) {
  const Icon = item.icon;
  const isActive = isItemActive(item, pathname);
  return (
    <Link
      href={item.href}
      className={`sidebar-link${isActive ? ' active' : ''}`}
      aria-label={displayLabel ? item.label : undefined}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{displayLabel ?? item.label}</span>
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
