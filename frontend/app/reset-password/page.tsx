'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ResetPasswordPage() {
  const router = useRouter(); const [token, setToken] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [done, setDone] = useState(false);
  useEffect(()=>setToken(new URLSearchParams(window.location.search).get('token') || ''), []);
  async function submit(e: FormEvent){ e.preventDefault(); setError(''); if(!token) return setError('Token reset tidak ditemukan'); if(password !== confirm) return setError('Konfirmasi password tidak sama'); setLoading(true); try { const res=await fetch(`${API}/auth/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})}); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(Array.isArray(data.message)?data.message.join(', '):data.message||'Reset password gagal'); setDone(true); setTimeout(()=>router.push('/'),1200); } catch(err){setError(err instanceof Error?err.message:'Reset password gagal')} finally{setLoading(false)} }
  if(done) return <main className="auth-page"><div className="auth-card"><div className="logo">CTI Platform</div><div className="success">Password berhasil diubah. Mengarahkan ke Login...</div></div></main>;
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><div className="logo">CTI Platform</div><div className="muted">Buat password baru</div><h1 className="auth-title">Reset password</h1><div className="field"><label>Password baru</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} autoComplete="new-password" required /></div><div className="field"><label>Konfirmasi password</label><input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} autoComplete="new-password" required /></div>{error&&<div className="error">{error}</div>}<button className="primary" disabled={loading}>{loading?'Menyimpan...':'Simpan password'}</button><div className="auth-footer"><Link href="/">Kembali ke Login</Link></div></form></main>;
}
