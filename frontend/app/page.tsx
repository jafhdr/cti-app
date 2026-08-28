import { Suspense } from 'react';
import LoginForm from './login-form';

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Memuat…</div>}>
      <LoginForm />
    </Suspense>
  );
}
