import { useState } from 'react';
import { api, money } from '../lib/api';
import { useSession } from '../lib/session';
import { Notice, PageHeader } from '../components/ui';

export default function Account() {
  const { user, config } = useSession();
  const min = config?.minPasswordLength || 8;
  const [cur, setCur] = useState(''); const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setMsg(null);
    try { await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: pw } }); setMsg({ tone: 'success', text: 'Password changed.' }); setCur(''); setPw(''); } catch (err) { setMsg({ tone: 'error', text: err.message }); }
  };
  return (
    <div className="max-w-xl">
      <PageHeader title="Account" />
      <div className="card p-5 mb-6 text-sm space-y-1">
        <div><span className="text-slate-500">Email:</span> {user.email}</div>
        {user.organization && <div><span className="text-slate-500">Organization:</span> {user.organization}</div>}
        <div><span className="text-slate-500">Credits:</span> {money(user.credits)}</div>
        <div><span className="text-slate-500">Commute distance measured to:</span> {user.jobSite?.lat != null ? (user.jobSite.label || user.jobSite.address || `${user.jobSite.lat}, ${user.jobSite.lon}`) : 'Not set (ask your administrator)'}</div>
      </div>
      <form onSubmit={submit} className="card p-5 space-y-3">
        <h2 className="font-semibold text-brand-900">Change password</h2>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div><label className="label">Current password</label><input className="input" type="password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div><label className="label">New password ({min}+ characters)</label><input className="input" type="password" minLength={min} required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <button className="btn-primary">Update password</button>
      </form>
    </div>
  );
}
