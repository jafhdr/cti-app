import { IntelligenceData } from '../../components/intelligence/IntelligenceData';
import { ThreatIntelligenceShell } from '../../components/intelligence/ThreatIntelligenceShell';

export default function ThreatIntelligenceOverviewPage() {
  return <ThreatIntelligenceShell title="Overview"><div className="header"><div><span className="source-eyebrow">THREAT INTELLIGENCE</span><h1>Understand what is targeting your organization.</h1><p className="muted">Explore indicators, actors, campaigns and relationships from your intelligence sources.</p></div></div><IntelligenceData overview /></ThreatIntelligenceShell>;
}
