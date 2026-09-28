'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError(''); setMessage('');
    try { const res = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }); const data = await res.json().catch(()=>({})); if (!res.ok) throw new Error(data.message || 'Permintaan gagal'); setMessage(data.message); }
    catch(err){ setError(err instanceof Error ? err.message : 'Permintaan gagal'); } finally { setLoading(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><div className="logo">CTI Platform</div><div className="muted">Pemulihan akses akun</div><h1 className="auth-title">Lupa password?</h1><p className="muted body-copy">Masukkan email akun Anda. Untuk MVP lokal, link reset akan ditampilkan di console backend.</p><div className="field"><label>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required /></div>{error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}<button className="primary" disabled={loading}>{loading ? 'Mengirim...' : 'Kirim link reset'}</button><div className="auth-footer"><Link href="/login">Kembali ke Login</Link></div></form></main>;
}
