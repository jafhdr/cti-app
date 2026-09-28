'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', organization: '', organizationSlug: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (form.password !== form.confirmPassword) return setError('Konfirmasi password tidak sama');
    if (form.password.length < 8) return setError('Password minimal 8 karakter');
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: form.name, email: form.email, password: form.password, organization: form.organization, organizationSlug: form.organizationSlug }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Pendaftaran gagal');
      router.push('/?registered=success');
    } catch (err) { setError(err instanceof Error ? err.message : 'Pendaftaran gagal'); }
    finally { setLoading(false); }
  }

  return <main className="auth-page"><form className="auth-card wide" onSubmit={submit}>
    <div className="logo">CTI Platform</div><div className="muted">Buat workspace CTI baru</div><h1 className="auth-title">Create your account</h1>
    <div className="form-grid">
      <div className="field"><label>Nama lengkap</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoComplete="name" required /></div>
      <div className="field"><label>Email</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} autoComplete="email" required /></div>
      <div className="field"><label>Organisasi / Tenant</label><input value={form.organization} onChange={e => { const organization = e.target.value; setForm({...form, organization, organizationSlug: slugify(organization)}) }} required /></div>
      <div className="field"><label>Slug organisasi</label><input value={form.organizationSlug} onChange={e => setForm({...form, organizationSlug: slugify(e.target.value)})} placeholder="contoh: perusahaan-anda" required /></div>
      <div className="field"><label>Password</label><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm({...form, password: e.target.value})} autoComplete="new-password" minLength={8} required /><button type="button" className="password-toggle" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Sembunyikan' : 'Lihat'}</button></div></div>
      <div className="field"><label>Konfirmasi password</label><input type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={e => setForm({...form, confirmPassword: e.target.value})} autoComplete="new-password" minLength={8} required /></div>
    </div>
    {error && <div className="error">{error}</div>}
    <button className="primary" disabled={loading}>{loading ? 'Membuat akun...' : 'Create account'}</button>
    <div className="auth-footer">Sudah punya akun? <Link href="/login">Login</Link></div>
  </form></main>;
}
