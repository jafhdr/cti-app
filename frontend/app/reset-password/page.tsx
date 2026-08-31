'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function readMessage(data: unknown, fallback: string): string {
  if (typeof data !== 'object' || data === null || !('message' in data)) return fallback;
  const message = data.message;
  if (typeof message === 'string') return message;
  return Array.isArray(message) ? message.filter((item): item is string => typeof item === 'string').join(', ') || fallback : fallback;
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token) return setError('Token reset tidak ditemukan. Minta link reset baru.');
    if (password !== confirmation) return setError('Konfirmasi password tidak sama.');

    setIsSaving(true);
    try {
      const response = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readMessage(data, 'Reset password gagal.'));
      setIsComplete(true);
      window.setTimeout(() => router.replace('/'), 1200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reset password gagal.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isComplete) return <main className="auth-page"><div className="auth-card"><div className="logo">CTI Platform</div><div className="success">Password berhasil diubah. Mengarahkan ke Login...</div></div></main>;

  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><div className="logo">CTI Platform</div><div className="muted">Buat password baru</div><h1 className="auth-title">Reset password</h1><div className="field"><label htmlFor="new-password">Password baru</label><input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></div><div className="field"><label htmlFor="confirm-password">Konfirmasi password</label><input id="confirm-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} autoComplete="new-password" required /></div>{error && <div className="error" role="alert">{error}</div>}<button className="primary" disabled={isSaving}>{isSaving ? 'Menyimpan...' : 'Simpan password'}</button><div className="auth-footer"><Link href="/">Kembali ke Login</Link></div></form></main>;
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="auth-page"><div className="auth-card">Memuat reset password...</div></main>}><ResetPasswordForm /></Suspense>;
}
