'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Table } from '../../../components/ui/table';
import { ThreatIntelligenceShell, useThreatIntelligenceTenant } from '../../../components/intelligence/ThreatIntelligenceShell';
import type { IntelligenceOverview } from '../../../lib/threat-intelligence';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const entityTypes = ['SOURCE', 'FEED', 'THREAT_ACTOR', 'CAMPAIGN', 'MALWARE', 'TOOL', 'VULNERABILITY', 'REPORT'] as const;
const emptyEntity = { type: 'THREAT_ACTOR', name: '', severity: 'MEDIUM', confidence: '50', description: '' };
const emptyRelationship = { sourceId: '', targetId: '', relationshipType: 'USES', description: '' };

export default function IntelligenceHubPage() {
  return <ThreatIntelligenceShell title="Intelligence Hub"><IntelligenceHubContent /></ThreatIntelligenceShell>;
}

function IntelligenceHubContent() {
  const [data, setData] = useState<IntelligenceOverview>({ entities: [], relationships: [] });
  const [entity, setEntity] = useState(emptyEntity);
  const [relationship, setRelationship] = useState(emptyRelationship);
  const [form, setForm] = useState<'entity' | 'relationship' | null>(null);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState('');
  const { tenantId, ready } = useThreatIntelligenceTenant();
  async function load(): Promise<void> { const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''; const response = await fetch(`${API}/intelligence/overview${query}`, { credentials: 'include', cache: 'no-store' }); if (!response.ok) { const failure: unknown = await response.json().catch(() => null); setDenied(response.status === 403); throw new Error(typeof failure === 'object' && failure !== null && 'message' in failure ? String(failure.message) : 'Gagal memuat Intelligence Hub.'); } setDenied(false); setData(await response.json()); }
  useEffect(() => { if (ready) load().catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : 'Gagal memuat Intelligence Hub.')); }, [ready, tenantId]);
  async function submit(event: FormEvent<HTMLFormElement>, path: string, body: object): Promise<void> { event.preventDefault(); const response = await fetch(`${API}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(tenantId ? { tenantId } : {}) }) }); if (!response.ok) { setMessage('Data tidak dapat disimpan. Periksa input dan hak akses Anda.'); return; } setForm(null); setMessage('Data Intelligence Hub berhasil disimpan.'); await load(); }
  if (denied) return <section><h1>Akses modul dibatasi</h1><p role="alert" className="error">{message}</p><Link href="/dashboard">Kembali ke Dashboard</Link></section>;
  return <><div className="header"><div><h1>Intelligence Hub</h1><p className="muted">Konteks investigasi melalui entitas CTI dan hubungan di antaranya.</p></div><div className="ioc-actions"><Button view="action" onClick={() => setForm('entity')}>Tambah entitas</Button><Button view="outlined" onClick={() => setForm('relationship')}>Tambah relasi</Button></div></div>{message && <p role="status">{message}</p>}{form === 'entity' && <Card view="outlined" className="ti-entity-card"><form className="ioc-form" onSubmit={event => submit(event, '/intelligence/entities', { ...entity, confidence: Number(entity.confidence) })}><label>Jenis<select value={entity.type} onChange={event => setEntity({ ...entity, type: event.target.value })}>{entityTypes.map(type => <option key={type}>{type}</option>)}</select></label><label>Nama<input required value={entity.name} onChange={event => setEntity({ ...entity, name: event.target.value })} /></label><label>Severity<select value={entity.severity} onChange={event => setEntity({ ...entity, severity: event.target.value })}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(value => <option key={value}>{value}</option>)}</select></label><label>Confidence<input type="number" min="0" max="100" value={entity.confidence} onChange={event => setEntity({ ...entity, confidence: event.target.value })} /></label><label className="ioc-wide">Deskripsi<textarea value={entity.description} onChange={event => setEntity({ ...entity, description: event.target.value })} /></label><Button view="action" type="submit">Simpan</Button></form></Card>}{form === 'relationship' && <Card view="outlined" className="ti-entity-card"><form className="ioc-form" onSubmit={event => submit(event, '/intelligence/relationships', relationship)}><EntitySelect label="Sumber" value={relationship.sourceId} entities={data.entities} onChange={sourceId => setRelationship({ ...relationship, sourceId })} /><EntitySelect label="Target" value={relationship.targetId} entities={data.entities} onChange={targetId => setRelationship({ ...relationship, targetId })} /><label>Tipe relasi<input required value={relationship.relationshipType} onChange={event => setRelationship({ ...relationship, relationshipType: event.target.value })} /></label><label className="ioc-wide">Deskripsi<textarea value={relationship.description} onChange={event => setRelationship({ ...relationship, description: event.target.value })} /></label><Button view="action" type="submit">Simpan</Button></form></Card>}<section className="section"><h2>CTI Entities</h2><Table data={[...data.entities]} columns={[{ id: 'name', name: 'Nama', template: item => item.name }, { id: 'type', name: 'Jenis', template: item => item.type }, { id: 'severity', name: 'Severity', template: item => item.severity }, { id: 'confidence', name: 'Confidence', template: item => `${item.confidence}%` }]} /></section><section className="section"><h2>Relationships</h2><Table data={[...data.relationships]} columns={[{ id: 'source', name: 'Sumber', template: item => item.source.name }, { id: 'relationshipType', name: 'Relasi', template: item => item.relationshipType }, { id: 'target', name: 'Target', template: item => item.target.name }]} /></section></>;
}

function EntitySelect({ label, value, entities, onChange }: { readonly label: string; readonly value: string; readonly entities: IntelligenceOverview['entities']; readonly onChange: (value: string) => void }) { return <label>{label}<select required value={value} onChange={event => onChange(event.target.value)}><option value="">Pilih entitas</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name} ({entity.type})</option>)}</select></label>; }
