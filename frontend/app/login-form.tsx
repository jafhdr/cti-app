'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

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

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo">CTI Platform</div>

        <div className="muted">
          Cyber Threat Intelligence
        </div>

        <h1 className="auth-title">
          Masuk ke akun Anda
        </h1>

        {registered === 'success' && (
          <div className="success">
            Akun berhasil dibuat. Silakan login menggunakan
            akun Anda.
          </div>
        )}

        <div className="field">
          <label htmlFor="email">
            Email
          </label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="field">
          <div className="label-row">
            <label htmlFor="password">
              Password
            </label>

            <Link href="/forgot-password">
              Lupa password?
            </Link>
          </div>

          <div className="password-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              minLength={8}
              required
            />

            <button
              type="button"
              className="password-toggle"
              onClick={() =>
                setShowPassword((v) => !v)
              }
            >
              {showPassword
                ? 'Sembunyikan'
                : 'Lihat'}
            </button>
          </div>
        </div>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <button
          className="primary"
          disabled={loading}
        >
          {loading ? 'Memproses...' : 'Login'}
        </button>

        <div className="auth-footer">
          Belum punya akun?{' '}
          <Link href="/signup">
            Sign up
          </Link>
        </div>

        <div className="security-note">
          Dengan login, sesi Anda dilindungi menggunakan
          HttpOnly cookie.
        </div>
      </form>
    </main>
  );
}
