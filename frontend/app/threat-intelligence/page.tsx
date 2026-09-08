import { IntelligenceData } from '../../components/intelligence/IntelligenceData';
import { ThreatIntelligenceShell } from '../../components/intelligence/ThreatIntelligenceShell';

export default function ThreatIntelligenceOverviewPage() {
  return <ThreatIntelligenceShell title="Overview"><div className="header"><div><h1>Threat Intelligence</h1><p className="muted">Ringkasan operasional berbasis data CTI aktual pada tenant Anda.</p></div></div><IntelligenceData overview /></ThreatIntelligenceShell>;
}
