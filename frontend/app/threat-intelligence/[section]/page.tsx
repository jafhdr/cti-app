import { notFound } from 'next/navigation';
import { IntelligenceData } from '../../../components/intelligence/IntelligenceData';
import { ThreatIntelligenceShell } from '../../../components/intelligence/ThreatIntelligenceShell';
import { intelligenceSections } from '../../../lib/threat-intelligence';

export function generateStaticParams() { return intelligenceSections.filter(section => section.slug !== 'campaigns').map(section => ({ section: section.slug })); }

export default async function IntelligenceSectionPage({ params }: { readonly params: Promise<{ readonly section: string }> }) {
  const { section: slug } = await params;
  const section = intelligenceSections.find(item => item.slug === slug);
  if (!section) notFound();
  return <ThreatIntelligenceShell title={section.label}><div className="header"><div><h1>{section.label}</h1><p className="muted">Entitas {section.label.toLowerCase()} pada workspace tenant aktif.</p></div></div><IntelligenceData types={section.types} /></ThreatIntelligenceShell>;
}
