import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Logo } from '../components/Shell';
import { Notice } from '../components/ui';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setState({ error: 'Passwords do not match.' });
    setState({ busy: true });
    try { await api('/auth/reset', { method: 'POST', body: { token: params.get('token'), newPassword: pw } }); setState({ done: true }); } catch (err) { setState({ error: err.message }); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4">
        <Logo />
        <h2 className="text-xl font-semibold text-brand-900">Choose a new password</h2>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {state.done ? <Notice tone="success">Password updated. <Link className="underline" to="/login">Sign in</Link></Notice> : (<>
          <div><label className="label">New password (10+ characters)</label><input className="input" type="password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label className="label">Repeat password</label><input className="input" type="password" minLength={10} required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn-primary w-full" disabled={state.busy}>Save password</button>
        </>)}
      </form>
    </div>
  );
}
