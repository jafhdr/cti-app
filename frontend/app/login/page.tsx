import type { Metadata } from 'next';
import { Suspense } from 'react';
import LoginForm from '../login-form';

export const metadata: Metadata = { title: 'Sign In | SICTI', description: 'Sign in to SICTI.' };

export default function LoginPage() {
  return <Suspense fallback={<div className="auth-page">Memuat…</div>}><LoginForm /></Suspense>;
}
