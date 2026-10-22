'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
type Notice = { readonly id: string; readonly title: string; readonly preview?: string; readonly sourceModule?: string; readonly severity: string | null; readonly createdAt: string; readonly readAt: string | null; readonly route: string | null };
type NoticePage = { readonly items: readonly Notice[]; readonly unreadCount: number; readonly hasMore: boolean; readonly snapshotAt?: string; readonly partialFailures?: readonly string[] };
type Props = { readonly role: Role; readonly tenantId: string };

export function DashboardBell(props: Props) {
  return <BellSession key={`${props.role}:${props.tenantId}`} {...props} />;
}

function BellSession({ role, tenantId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [data, setData] = useState<NoticePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const session = useRef<AbortController | null>(null);
  const version = useRef(0);
  const snapshot = useRef<string | null>(null);
  const ready = role !== 'SUPER_ADMIN' || Boolean(tenantId);
  const params = useCallback((number: number) => {
    const query = new URLSearchParams({ page: String(number), limit: '10' });
    if (role === 'SUPER_ADMIN') query.set('tenantId', tenantId);
    if (snapshot.current) query.set('snapshotAt', snapshot.current);
    return query;
  }, [role, tenantId]);
  const load = useCallback(async (number: number) => {
    if (!ready) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const request = ++version.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/dashboard/notifications?${params(number)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted || request !== version.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setDenied(true); setData(null); return; }
        throw new Error('Notifikasi tidak tersedia.');
      }
      const body: NoticePage = await response.json();
      if (!controller.signal.aborted && request === version.current) { snapshot.current = body.snapshotAt ?? null; setData(body); setDenied(false); }
    } catch (cause) {
      if (!controller.signal.aborted && request === version.current) { setData(null); setError(cause instanceof Error ? cause.message : 'Gagal memuat notifikasi.'); }
    } finally { if (!controller.signal.aborted && request === version.current) setLoading(false); }
  }, [params, ready]);
  useEffect(() => {
    session.current = new AbortController();
    return () => { session.current?.abort(); active.current?.abort(); version.current += 1; };
  }, []);
  useEffect(() => { void load(page); return () => active.current?.abort(); }, [load, page]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function close() { setOpen(false); button.current?.focus(); }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }
    function outside(event: PointerEvent) { if (event.target instanceof Node && !wrap.current?.contains(event.target)) setOpen(false); }
    window.addEventListener('keydown', onKey); window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => {
    if (open && document.activeElement === document.body) {
      panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }, [data, open]);

  async function markRead(id: string, navigate = false) {
    if (busy) return;
    setBusy(id); setError('');
    try {
      const query = role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
      const signal = session.current?.signal;
      const response = await fetch(`${API}/dashboard/notifications/${encodeURIComponent(id)}/read${query}`, { method: 'PATCH', credentials: 'include', signal });
      if (signal?.aborted) return;
      if (!response.ok) {
        setData(null);
        if (response.status === 401 || response.status === 403) setDenied(true);
        throw new Error(response.status === 404 ? 'Notifikasi atau tujuan sudah tidak tersedia.' : 'Gagal menandai notifikasi.');
      }
      const body: { readonly route?: string | null } = await response.json();
      if (signal?.aborted) return;
      if (navigate && body.route && /^\/(cases\/|appsec\/findings\/|attack-surface\/assets\?|threat-intelligence\/(?:feeds|mitre-attack|ioc-candidates)$|indicators(?:\?indicatorId=[A-Za-z0-9_-]+)?$)/.test(body.route)) router.push(body.route);
      else await load(pageRef.current);
    } catch (cause) { if (!session.current?.signal.aborted) setError(cause instanceof Error ? cause.message : 'Gagal menandai notifikasi.'); }
    finally { if (!session.current?.signal.aborted) setBusy(null); }
  }

  return <div className="dashboard-bell-wrap" ref={wrap}>
    <button ref={button} className="dashboard-bell-button" type="button" aria-label={data?.unreadCount ? `Notifications, ${data.unreadCount} belum dibaca` : 'Notifications'} aria-haspopup="dialog" aria-expanded={open} disabled={!ready} onClick={() => { if (!open) { snapshot.current = null; if (page !== 1) setPage(1); else void load(1); } setOpen(current => !current); }}>
      <Bell size={20} aria-hidden="true" />{data && data.unreadCount > 0 && <span className="dashboard-bell-badge" aria-hidden="true">{data.unreadCount > 99 ? '99+' : data.unreadCount}</span>}
    </button>
    {open && <section ref={panel} className="dashboard-bell-popover" role="dialog" aria-modal="false" aria-label="Notifications">
      <header><strong>Notifications</strong><button type="button" onClick={() => { setOpen(false); button.current?.focus(); }} aria-label="Tutup notifikasi">×</button></header>
      {loading && <p role="status">Memuat notifikasi...</p>}
      {denied && <p>Akses notifikasi tidak tersedia.</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => void load(page)}>Coba lagi</button></p>}
      {!!data?.partialFailures?.length && <p role="status">Sebagian sumber belum tersedia. Coba lagi untuk memperbarui.</p>}
      {!loading && !denied && !error && data?.items.length === 0 && <p>Belum ada notifikasi.</p>}
      {!loading && !denied && data && <><p className="sr-only" role="status">{data.unreadCount} notifikasi belum dibaca.</p><ul>{data.items.map(item => <li key={item.id} className={item.readAt ? 'is-read' : 'is-unread'}>
        <div><span className="dashboard-notice-source">{item.sourceModule ?? 'ASM'}</span>{item.severity && <span>{item.severity}</span>}<time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString('id-ID')}>{new Date(item.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>
        {item.route ? <a href={item.route} onClick={event => { event.preventDefault(); void markRead(item.id, true); }}>{item.title}</a> : <strong>{item.title}</strong>}
        {item.preview && item.preview !== item.title && <p className="dashboard-notice-preview">{item.preview}</p>}
        {!item.route && <small>Tujuan sudah tidak tersedia.</small>}
        <div><small>{item.readAt ? 'Dibaca' : 'Belum dibaca'}</small>{!item.readAt && <button type="button" disabled={busy !== null} onClick={() => void markRead(item.id)}>{busy === item.id ? 'Menyimpan...' : 'Mark as read'}</button>}</div>
      </li>)}</ul><footer><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Sebelumnya</button><span>Halaman {page}</span><button type="button" disabled={!data.hasMore || loading} onClick={() => setPage(current => current + 1)}>Berikutnya</button></footer></>}
    </section>}
  </div>;
}
