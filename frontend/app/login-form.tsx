'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import './login.css';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const registered = searchParams.get('registered');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.message || 'Email atau password salah'
        );
      }

      // Login berhasil → masuk Dashboard
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Login gagal'
      );
    } finally {
      setLoading(false);
    }
  }

  return <main className="sicti-login">
    <header className="sicti-login-header"><Link href="/" className="sicti-login-brand"><img src="/sicti-mark.png" alt="" width={27} height={27} /> SICTI</Link><p>Need help? <a href="mailto:ntsisi@sisi.sig.id">Contact support</a></p></header>
    <form className="sicti-login-card" onSubmit={submit}>
      <img className="sicti-login-mark" src="/sicti-mark.png" alt="" width={27} height={27} /><h1>Welcome to SICTI</h1><p className="sicti-login-subtitle">Kelola kebutuhan Anda bersama kami!</p>
      <div className="sicti-login-tabs"><span aria-current="page">Sign In</span><Link href="/signup">Sign Up</Link></div>
      {registered === 'success' && <div className="success">Akun berhasil dibuat. Silakan login menggunakan akun Anda.</div>}
      <label htmlFor="email">Email address</label><div className="sicti-login-input"><Mail size={17} /><input id="email" type="email" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
      <label htmlFor="password">Password</label><div className="sicti-login-input"><LockKeyhole size={17} /><input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={8} required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((v) => !v)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
      <div className="sicti-login-options"><label><input type="checkbox" defaultChecked /> Remember me</label><Link href="/forgot-password">Forgot password?</Link></div>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="sicti-login-submit" disabled={loading}>{loading ? 'Memproses...' : 'Sign In'} <ArrowRight size={18} /></button>
      <div className="sicti-login-divider">Or continue with</div><div className="sicti-login-google" aria-label="Google Sign In unavailable">G</div>
    </form><footer className="sicti-login-footer"><span>&copy; 2026 SICTI</span><nav><a href="mailto:ntsisi@sisi.sig.id?subject=Privacy">Privacy</a><a href="mailto:ntsisi@sisi.sig.id?subject=Terms">Terms</a><a href="mailto:ntsisi@sisi.sig.id?subject=Security">Security</a></nav></footer>
  </main>;
}
