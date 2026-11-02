'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/card';
import type { IntelligenceOverview } from '../../lib/threat-intelligence';
import { useThreatIntelligenceTenant } from './ThreatIntelligenceShell';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function IntelligenceData({ types, overview = false }: { readonly types?: readonly string[]; readonly overview?: boolean }) {
  const [data, setData] = useState<IntelligenceOverview>({ entities: [], relationships: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { tenantId, ready } = useThreatIntelligenceTenant();
  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
    fetch(`${API}/intelligence/overview${query}`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Gagal memuat data Threat Intelligence.');
      setData(await response.json());
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Gagal memuat data Threat Intelligence.')).finally(() => setLoading(false));
  }, [ready, tenantId]);
  const entities = types ? data.entities.filter(entity => types.includes(entity.type)) : data.entities;
  if (loading) return <Card view="outlined" className="ti-entity-card"><p className="muted" role="status" aria-live="polite">Memuat data Threat Intelligence...</p></Card>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (overview) {
    const linkedIndicators = data.entities.reduce((total, entity) => total + entity.indicators.length, 0);
    const recent = [...data.entities].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
    return <div className="editorial-module"><div className="editorial-section-heading"><span className="source-eyebrow">INTELLIGENCE WORKSPACE</span><h2>What the sources show</h2></div><section className="editorial-metrics" aria-label="Threat intelligence summary"><div><span>CTI entities</span><strong>{data.entities.length}</strong></div><div><span>Relationships</span><strong>{data.relationships.length}</strong></div><div><span>Linked indicators</span><strong>{linkedIndicators}</strong></div><div><span>Entity types</span><strong>{new Set(data.entities.map(entity => entity.type)).size}</strong></div></section><section className="editorial-feature"><div><span className="source-eyebrow">THREAT LANDSCAPE</span><h2>Intelligence in context.</h2><p>Entities and verified relationships from the selected tenant. Follow the intelligence hub to inspect and connect them.</p></div><div className="editorial-type-map">{Array.from(new Set(data.entities.map(entity => entity.type))).map(type => <div key={type}><span>{type.replaceAll("_", " ")}</span><strong>{data.entities.filter(entity => entity.type === type).length}</strong></div>)}</div></section><div className="editorial-section-heading"><span className="source-eyebrow">RECENT INTELLIGENCE</span><h2>Recently updated entities</h2></div><EntityList entities={recent} empty="Belum ada entitas Threat Intelligence." compact /><div className="editorial-section-heading ti-workflow-heading"><span className="source-eyebrow">INTELLIGENCE WORKFLOWS</span><h2>Continue the investigation</h2></div><nav className="ti-workflows" aria-label="Intelligence workflows"><Link href="/threat-intelligence/indicators"><strong>Indicators</strong><small>Inspect and match</small><span aria-hidden="true">→</span></Link><Link href="/threat-intelligence/hub"><strong>Intelligence hub</strong><small>Explore relationships</small><span aria-hidden="true">→</span></Link></nav></div>;
  }
  return <EntityList entities={entities} empty="Belum ada data pada kategori ini." />;
}

function descriptionExcerpt(description: string): string {
  const plain = description.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/\([^)]*Citation:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const sentence = plain.slice(0, 210).match(/^.*?[.!?](?=\s|$)/)?.[0];
  if (sentence) return sentence;
  if (plain.length <= 150) return plain;
  const clause = plain.slice(0, 120).match(/^.*[,;:]/)?.[0];
  if (clause && clause.length >= 80 && !/\b(?:the|a|an|and|or|financial|retail|healthcare)[,;:]$/i.test(clause)) return `${clause.slice(0, -1)}.`;
  return `${plain.slice(0, 105).replace(/\s+\S*$/, '').replace(/[,;:]$/, '')}…`;
}

function EntityList({ entities, empty, compact = false }: { readonly entities: IntelligenceOverview['entities']; readonly empty: string; readonly compact?: boolean }) {
  if (entities.length === 0) return <Card view="outlined" className="ti-entity-card"><p className="muted">{empty}</p></Card>;
  return <div className="ti-entity-list">{entities.map(entity => <Card view="outlined" className="ti-entity-card" key={entity.id}><header><strong>{entity.name}</strong><span>{entity.severity}</span></header>{entity.description && <p title={compact ? entity.description : undefined} aria-label={compact ? entity.description : undefined}>{compact ? descriptionExcerpt(entity.description) : entity.description}</p>}<div className="ti-entity-meta"><span>{entity.type.replaceAll('_', ' ')}</span><span>Confidence {entity.confidence}%</span><span>{entity.indicators.length} indicator</span></div></Card>)}</div>;
}
function Metric({ label, value }: { readonly label: string; readonly value: number }) { return <div className="card"><div className="card-title">{label}</div><div className="metric">{value}</div></div>; }
