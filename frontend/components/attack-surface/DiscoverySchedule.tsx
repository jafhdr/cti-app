'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Asset } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Schedule = { readonly enabled: boolean; readonly intervalMinutes: number; readonly lastRunAt: string | null; readonly nextRunAt: string | null };
type Run = { readonly id: string; readonly status: string; readonly source: string; readonly startedAt: string; readonly completedAt: string | null; readonly discovered: number; readonly failed: number; readonly error: string | null };
type Change = { readonly id: string; readonly type: string; readonly entityKey: string; readonly previousValue: string | null; readonly currentValue: string | null; readonly detectedAt: string; readonly run: { readonly source: string; readonly status: string } };
const date = (value: string | null) => value ? new Date(value).toLocaleString('id-ID') : 'Never';
const typeLabel = (value: string) => value.replaceAll('_', ' ').toLowerCase();
const kind = (type: string) => type.endsWith('NOT_OBSERVED') || type.endsWith('STALE') ? 'no longer observed' : type.endsWith('CHANGED') ? 'changed' : 'newly observed';

export function DiscoverySchedule({ asset, tenantQuery, canManage, refresh, onRunComplete }: { readonly asset: Asset; readonly tenantQuery: string; readonly canManage: boolean; readonly refresh: number; readonly onRunComplete: () => void }) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [changes, setChanges] = useState<readonly Change[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const base = `${API}/attack-surface/assets/${asset.id}/discovery`;
  const suffix = tenantQuery ? `?${tenantQuery}` : '';
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [scheduleResponse, runsResponse, changesResponse] = await Promise.all(['schedule', 'runs', 'changes'].map(path => fetch(`${base}/${path}${suffix}`, { credentials: 'include', cache: 'no-store' })));
      if (!scheduleResponse.ok || !runsResponse.ok || !changesResponse.ok) throw new Error('Could not load discovery history.');
      const scheduleData: Schedule = await scheduleResponse.json();
      const runData: readonly Run[] = await runsResponse.json();
      const changeData: readonly Change[] = await changesResponse.json();
      setSchedule(scheduleData); setEnabled(scheduleData.enabled); setIntervalMinutes(scheduleData.intervalMinutes); setRuns(runData); setChanges(changeData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load discovery history.'); }
    finally { setLoading(false); }
  }, [base, suffix]);
  useEffect(() => { void load(); }, [load, refresh]);
  async function save() {
    setSaving(true); setError('');
    try {
      const response = await fetch(`${base}/schedule${suffix}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, intervalMinutes }) });
      if (!response.ok) throw new Error('Could not update discovery schedule.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update discovery schedule.'); }
    finally { setSaving(false); }
  }
  async function run() {
    setSaving(true); setError('');
    try {
      const response = await fetch(`${base}/runs${suffix}`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Discovery run failed.');
      await load();
      onRunComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Discovery run failed.'); }
    finally { setSaving(false); }
  }
  return <section className="asm-intelligence-section asm-discovery-schedule" aria-label="Discovery schedule and change history">
    <div className="asm-section-heading"><span className="source-eyebrow">EXPOSURE MONITORING</span><h3>Discovery schedule</h3></div>
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {loading ? <p role="status">Loading discovery schedule...</p> : <>
      <dl className="asm-service-metrics"><div><dt>Schedule</dt><dd>{schedule?.enabled ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Interval</dt><dd>{schedule?.intervalMinutes ?? 1440} min</dd></div><div><dt>Last run</dt><dd>{date(schedule?.lastRunAt ?? null)}</dd></div><div><dt>Next run</dt><dd>{date(schedule?.nextRunAt ?? null)}</dd></div><div><dt>Last status</dt><dd>{runs[0]?.status ?? 'No runs'}</dd></div></dl>
      {canManage && <div className="asm-schedule-controls"><label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enable scheduled discovery</label><label>Interval (minutes)<input type="number" min={60} max={43200} value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))} /></label><Button view="outlined" size="s" disabled={saving} onClick={() => void save()}>{saving ? 'Working...' : 'Save schedule'}</Button><Button view="outlined" size="s" disabled={saving} onClick={() => void run()}>Run discovery now</Button></div>}
      <h4>Recent runs</h4>{runs.length ? <ul className="asm-change-list">{runs.slice(0, 5).map(item => <li key={item.id}><strong>{item.status}</strong> · {item.source} · {date(item.startedAt)} · {item.discovered} observed · {item.failed} failed{item.error && <span role="note">{item.error}</span>}</li>)}</ul> : <p>No discovery runs recorded.</p>}
      <h4>Change history</h4>{changes.length ? <ol className="asm-change-list">{changes.map(item => <li key={item.id}><span className="source-eyebrow">{kind(item.type)}</span><strong>{typeLabel(item.type)}</strong><span>{item.entityKey}</span>{(item.previousValue || item.currentValue) && <span>{item.previousValue || '—'} → {item.currentValue || '—'}</span>}<small>{date(item.detectedAt)} · {item.run.source} · {item.run.status}</small></li>)}</ol> : <p>No exposure changes recorded.</p>}
    </>}
  </section>;
}
