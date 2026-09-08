'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/card';
import type { IntelligenceOverview } from '../../lib/threat-intelligence';
import { useThreatIntelligenceTenant } from './ThreatIntelligenceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function IntelligenceData({ types, overview = false }: { readonly types?: readonly string[]; readonly overview?: boolean }) {
  const [data, setData] = useState<IntelligenceOverview>({ entities: [], relationships: [] });
  const [error, setError] = useState('');
  const { tenantId, ready } = useThreatIntelligenceTenant();
  useEffect(() => {
    if (!ready) return;
    const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
    fetch(`${API}/intelligence/overview${query}`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Gagal memuat data Threat Intelligence.');
      setData(await response.json());
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Gagal memuat data Threat Intelligence.'));
  }, [ready, tenantId]);
  const entities = types ? data.entities.filter(entity => types.includes(entity.type)) : data.entities;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (overview) {
    const linkedIndicators = data.entities.reduce((total, entity) => total + entity.indicators.length, 0);
    return <><div className="grid"><Metric label="CTI Entities" value={data.entities.length} /><Metric label="Relationships" value={data.relationships.length} /><Metric label="Linked Indicators" value={linkedIndicators} /><Metric label="Entity Types" value={new Set(data.entities.map(entity => entity.type)).size} /></div><EntityList entities={data.entities.slice(0, 8)} empty="Belum ada entitas Threat Intelligence." /></>;
  }
  return <EntityList entities={entities} empty="Belum ada data pada kategori ini." />;
}

function EntityList({ entities, empty }: { readonly entities: IntelligenceOverview['entities']; readonly empty: string }) {
  if (entities.length === 0) return <Card view="outlined" className="ti-entity-card"><p className="muted">{empty}</p></Card>;
  return <div className="ti-entity-list">{entities.map(entity => <Card view="outlined" className="ti-entity-card" key={entity.id}><header><strong>{entity.name}</strong><span>{entity.severity}</span></header>{entity.description && <p>{entity.description}</p>}<div className="ti-entity-meta"><span>{entity.type.replaceAll('_', ' ')}</span><span>Confidence {entity.confidence}%</span><span>{entity.indicators.length} indicator</span></div></Card>)}</div>;
}
function Metric({ label, value }: { readonly label: string; readonly value: number }) { return <div className="card"><div className="card-title">{label}</div><div className="metric">{value}</div></div>; }
