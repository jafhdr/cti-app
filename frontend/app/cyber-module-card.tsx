'use client';

import type { PointerEvent } from 'react';
import { ArrowRight, Crosshair, Radar, GitBranch, LockKeyhole } from 'lucide-react';

type ModuleKind = 'intelligence' | 'surface' | 'cases' | 'administration';
type CardProps = {
  readonly title: string;
  readonly description: string;
  readonly target: string;
  readonly index: number;
  readonly kind: ModuleKind;
};

const subsystems = {
  intelligence: ['INDICATORS', 'ACTORS', 'CAMPAIGNS', 'REPORTS'],
  surface: ['DOMAINS', 'DNS', 'EDGES', 'SERVICES'],
  cases: ['OWNERS', 'INTEL', 'NOTES', 'EVIDENCE'],
  administration: ['ACCESS', 'ROLES', 'POLICY', 'AUDIT'],
} as const;

function ThreatIntelVisual() {
  return <div className="lp-threat-visual" aria-hidden="true">
    <div className="lp-threat-signal"><span className="lp-threat-reticle"><Crosshair size={20} strokeWidth={1.5} /><i /></span><svg viewBox="0 0 220 60" preserveAspectRatio="none"><path d="M0 30 H38 L58 12 H111 L135 30 H175 L190 17 H220" /><path className="lp-threat-flow" d="M0 30 H38 L58 12 H111 L135 30 H175 L190 17 H220" /><circle cx="38" cy="30" r="2" /><circle cx="111" cy="12" r="2" /><circle cx="175" cy="30" r="2" /></svg><span className="lp-threat-signal-label">SIGNAL → CORRELATION</span></div>
  </div>;
}

function ThreatFeaturePanels() {
  return <div className="lp-threat-features" aria-hidden="true">
      <span className="lp-threat-feature"><span className="lp-threat-bars"><i /><i /><i /><i /><i /></span><b>Indicators</b><small>SIGNALS</small></span>
      <span className="lp-threat-feature"><span className="lp-threat-actors"><i /><i /><i /><i /><i /><i /></span><b>Threat Actors</b><small>RELATIONS</small></span>
      <span className="lp-threat-feature"><span className="lp-threat-campaigns"><i /><i /><i /></span><b>Campaigns</b><small>CONTEXT</small></span>
      <span className="lp-threat-feature"><span className="lp-threat-report"><i /><i /><i /></span><b>Brief Reports</b><small>ANALYSIS</small></span>
  </div>;
}

function ModuleVisual({ kind }: { readonly kind: ModuleKind }) {
  return <div className={`lp-module-visual lp-module-${kind}`} aria-hidden="true">
    {kind === 'intelligence' && <>
      <svg className="lp-visual-wires" viewBox="0 0 300 120" preserveAspectRatio="none"><path d="M35 29 106 38 150 58 222 27M52 92 112 78 150 58 241 89M150 58 150 14" /><path className="lp-flow" d="M35 29 106 38 150 58 222 27M52 92 112 78 150 58 241 89" /></svg>
      <span className="lp-hub lp-intel-hub"><i /><i /></span>
      <span className="lp-mini-node lp-node-one">IOC</span><span className="lp-mini-node lp-node-two">ACTOR</span><span className="lp-mini-node lp-node-three">CAMPAIGN</span><span className="lp-mini-node lp-node-four">CONTEXT</span>
      <span className="lp-visual-status">● CORRELATING</span><span className="lp-visual-code">SIGNAL → CONTEXT</span>
    </>}
    {kind === 'surface' && <>
      <svg className="lp-visual-wires" viewBox="0 0 300 120" preserveAspectRatio="none"><path d="M43 60 104 27 167 57 237 28M104 27 110 91 167 57 236 91M167 57 237 28" /><path className="lp-flow" d="M43 60 104 27 167 57 237 28M104 27 110 91 167 57 236 91" /></svg>
      <span className="lp-mini-node lp-node-one">DOMAIN</span><span className="lp-mini-node lp-node-two">EDGE</span><span className="lp-mini-node lp-node-three">NODE</span><span className="lp-mini-node lp-node-four">SERVICE</span><span className="lp-discovery-node" />
      <span className="lp-scanline" /><span className="lp-visual-status">● DISCOVERED</span><span className="lp-visual-code">TOPOLOGY / ILLUSTRATIVE</span>
    </>}
    {kind === 'cases' && <>
      <span className="lp-timeline"><i /><i /><i /><i /><b /></span>
      <span className="lp-timeline-labels"><em>OPEN</em><em>TRIAGE</em><em>REVIEW</em><em>INVESTIGATE</em></span>
      <span className="lp-context-chip lp-chip-one">EVIDENCE</span><span className="lp-context-chip lp-chip-two">NOTES</span><span className="lp-context-chip lp-chip-three">INTEL</span>
      <span className="lp-visual-status">● IN REVIEW</span><span className="lp-visual-code">CONTEXT LINKED</span>
    </>}
    {kind === 'administration' && <>
      <svg className="lp-visual-wires" viewBox="0 0 300 120" preserveAspectRatio="none"><path d="M48 27 150 59 239 25M46 92 150 59 243 91" /><path className="lp-flow" d="M48 27 150 59 239 25M46 92 150 59 243 91" /></svg>
      <span className="lp-hub lp-admin-hub"><LockKeyhole size={18} strokeWidth={1.6} /><i /></span>
      <span className="lp-mini-node lp-node-one">ACCESS</span><span className="lp-mini-node lp-node-two">ROLE</span><span className="lp-mini-node lp-node-three">POLICY</span><span className="lp-mini-node lp-node-four">CONTROL</span>
      <span className="lp-visual-status">● PROTECTED</span><span className="lp-visual-code">PERIMETER / ACTIVE</span>
    </>}
    <div className="lp-subsystems">{subsystems[kind].map((name) => <span key={name}>{name}</span>)}</div>
  </div>;
}

const icons = { intelligence: Crosshair, surface: Radar, cases: GitBranch, administration: LockKeyhole } as const;

export function CyberModuleCard({ title, description, target, index, kind }: CardProps) {
  const Icon = icons[kind];
  function onPointerMove(event: PointerEvent<HTMLAnchorElement>) {
    if (event.pointerType !== 'mouse' || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    event.currentTarget.style.setProperty('--pointer-x', `${x * 100}%`);
    event.currentTarget.style.setProperty('--pointer-y', `${y * 100}%`);
    event.currentTarget.style.setProperty('--tilt-x', `${(0.5 - y) * 5}deg`);
    event.currentTarget.style.setProperty('--tilt-y', `${(x - 0.5) * 5}deg`);
  }

  function onPointerLeave(event: PointerEvent<HTMLAnchorElement>) {
    event.currentTarget.style.removeProperty('--tilt-x');
    event.currentTarget.style.removeProperty('--tilt-y');
  }

  if (kind === 'intelligence') return <a className="lp-card lp-cyber-card lp-threat-card" data-reveal="up" href={target} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
    <div className="lp-threat-header"><span className="lp-threat-number">01 <i /> ACTIVE</span><span className="lp-threat-system">SYS_FEED::DEMO <i /></span></div>
    <ThreatIntelVisual />
    <h3>{title}</h3><p>{description}</p><ThreatFeaturePanels /><ArrowRight className="lp-card-arrow" size={19} />
  </a>;

  return <a className="lp-card lp-cyber-card" data-reveal="up" href={target} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
    <span>0{index + 1}</span><Icon size={26} strokeWidth={1.6} /><ModuleVisual kind={kind} />
    <h3>{title}</h3><p>{description}</p><ArrowRight className="lp-card-arrow" size={19} />
  </a>;
}
