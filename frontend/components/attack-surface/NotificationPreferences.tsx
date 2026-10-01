'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAttackSurface } from './AttackSurfaceShell';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Preference = { readonly enabled: boolean; readonly minimumSeverity: 'HIGH' | 'CRITICAL' };

export function NotificationPreferences() {
  const { role, tenantId, ready } = useAttackSurface();
  const [preference, setPreference] = useState<Preference | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const loadId = useRef(0);
  const [enabled, setEnabled] = useState(true);
  const [minimumSeverity, setMinimumSeverity] = useState<Preference['minimumSeverity']>('HIGH');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const canEdit = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const currentQuery = useRef(query);
  currentQuery.current = query;
  const shownPreference = loadedQuery === query ? preference : null;
  const load = useCallback(async () => {
    if (!ready) return;
    const requestId = ++loadId.current;
    setLoading(true); setPreference(null); setLoadedQuery(null); setSaving(false); setError(''); setSaved(false);
    try {
      const response = await fetch(`${API}/attack-surface/notifications/preferences${query}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load notification preferences.');
      const body: Preference = await response.json();
      if (requestId !== loadId.current || currentQuery.current !== query) return;
      setPreference(body); setLoadedQuery(query); setEnabled(body.enabled); setMinimumSeverity(body.minimumSeverity);
    } catch (cause) { if (requestId === loadId.current && currentQuery.current === query) setError(cause instanceof Error ? cause.message : 'Unable to load notification preferences.'); }
    finally { if (requestId === loadId.current && currentQuery.current === query) setLoading(false); }
  }, [query, ready]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`${API}/attack-surface/notifications/preferences${query}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, minimumSeverity }) });
      if (!response.ok) throw new Error('Unable to save notification preferences.');
      const body: Preference = await response.json();
      if (currentQuery.current !== query) return;
      setPreference(body); setLoadedQuery(query); setEnabled(body.enabled); setMinimumSeverity(body.minimumSeverity); setSaved(true);
    } catch (cause) { if (currentQuery.current === query) setError(cause instanceof Error ? cause.message : 'Unable to save notification preferences.'); }
    finally { if (currentQuery.current === query) setSaving(false); }
  }

  return <section className="asm-intelligence-section" aria-label="Notification preferences">
    <div className="asm-section-heading"><span className="source-eyebrow">SETTINGS / NOTIFICATIONS</span><h2>Notification preferences</h2></div>
    <p>Choose which ASM Alerts appear in this tenant&apos;s in-app inbox.</p>
    {loading && <p role="status">Loading notification preferences...</p>}
    {!loading && shownPreference && <div className="asm-schedule-controls">
      <label>Channel<input type="text" value="In-App" disabled readOnly aria-label="Notification channel" /></label>
      <label><input type="checkbox" checked={enabled} disabled={!canEdit || saving} onChange={event => { setEnabled(event.target.checked); setSaved(false); }} /> Enabled</label>
      <label>Minimum severity<select value={minimumSeverity} disabled={!canEdit || !enabled || saving} onChange={event => { setMinimumSeverity(event.target.value === 'CRITICAL' ? 'CRITICAL' : 'HIGH'); setSaved(false); }}><option value="HIGH">HIGH</option><option value="CRITICAL">CRITICAL</option></select></label>
      {canEdit && <Button view="outlined" size="s" type="button" disabled={saving || (enabled === shownPreference.enabled && minimumSeverity === shownPreference.minimumSeverity)} onClick={() => void save()}>{saving ? 'Saving...' : 'Save preferences'}</Button>}
    </div>}
    {!loading && shownPreference && !canEdit && <p>Only an administrator can change notification preferences.</p>}
    {saved && <p role="status" className="success">Notification preferences saved.</p>}
    {error && <p role="alert" className="error">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
  </section>;
}
