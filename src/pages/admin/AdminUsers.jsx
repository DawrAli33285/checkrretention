import { useEffect, useState } from 'react';
import { api, fmtDate, money } from '../../lib/api';
import { Modal, Notice, PageHeader } from '../../components/ui';
import AdminNav from './AdminNav';

const blank = { email: '', password: '', name: '', organization: '', role: 'client', credits: 0 };

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [crediting, setCrediting] = useState(null); // { user, amount }
  const load = () => api('/admin/users').then((d) => setUsers(d.users));
  useEffect(() => { load(); }, []);
  const run = async (fn, ok) => { setMsg(null); try { await fn(); setMsg({ tone: 'success', text: ok }); await load(); return true; } catch (e) { setMsg({ tone: 'error', text: e.message }); return false; } };

  const credits = (u) => setCrediting({ user: u, amount: '100' });

  return (
    <div>
      <PageHeader title="Clients & users" actions={<button className="btn-primary" onClick={() => setCreating({ ...blank })}>Add user</button>} />
      <AdminNav />
      {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
      <div className="card overflow-x-auto">
        <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">User</th><th className="th">Role</th><th className="th text-right">Credits</th><th className="th">Job site</th><th className="th">Created</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{users.map((u) => (
            <tr key={u._id} className={u.active ? '' : 'opacity-50'}>
              <td className="td"><div className="font-medium">{u.email}</div><div className="text-xs text-slate-500">{[u.name, u.organization].filter(Boolean).join(' · ')}{!u.active && ' · disabled'}</div></td>
              <td className="td capitalize">{u.role}</td>
              <td className="td text-right">{money(u.credits)}</td>
              <td className="td text-xs">{u.jobSite?.lat != null ? (u.jobSite.label || u.jobSite.address || `${u.jobSite.lat}, ${u.jobSite.lon}`) : <span className="text-amber-700">not set</span>}</td>
              <td className="td text-xs">{fmtDate(u.createdAt)}</td>
              <td className="td whitespace-nowrap text-right space-x-2">
                <button className="text-brand-600 text-sm hover:underline" onClick={() => credits(u)}>Credits</button>
                <button className="text-brand-600 text-sm hover:underline" onClick={() => setEditing({ ...u, password: '', jobSite: { label: '', address: '', lat: '', lon: '', ...(u.jobSite || {}) } })}>Edit</button>
              </td>
            </tr>))}</tbody></table>
      </div>

      {crediting && (
        <Modal title={`Adjust credits for ${crediting.user.email}`} onClose={() => setCrediting(null)} footer={<><button className="btn-secondary" onClick={() => setCrediting(null)}>Cancel</button><button className="btn-primary" onClick={async () => { if (await run(() => api(`/admin/users/${crediting.user._id}/credits`, { method: 'POST', body: { amount: Number(crediting.amount) } }), 'Credits updated.')) setCrediting(null); }}>Apply</button></>}>
          <p className="text-sm text-slate-600">Current balance: <strong>{money(crediting.user.credits)}</strong></p>
          <div><label className="label">Amount in dollars (use a negative number to remove credits)</label><input className="input" type="number" step="0.01" value={crediting.amount} onChange={(e) => setCrediting({ ...crediting, amount: e.target.value })} /></div>
          {Number(crediting.amount) ? <p className="text-sm text-slate-500">New balance: {money(Number(crediting.user.credits) + Number(crediting.amount))}</p> : null}
        </Modal>
      )}

      {creating && (
        <Modal title="Add user" onClose={() => setCreating(null)} footer={<><button className="btn-secondary" onClick={() => setCreating(null)}>Cancel</button><button className="btn-primary" onClick={async () => { if (await run(() => api('/admin/users', { method: 'POST', body: creating }), 'User created. Share the temporary password securely.')) setCreating(null); }}>Create</button></>}>
          {['email', 'name', 'organization'].map((k) => <div key={k}><label className="label capitalize">{k}</label><input className="input" value={creating[k]} onChange={(e) => setCreating({ ...creating, [k]: e.target.value })} /></div>)}
          <div><label className="label">Temporary password (10+ characters)</label><input className="input" value={creating.password} onChange={(e) => setCreating({ ...creating, password: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">Role</label><select className="input" value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}><option value="client">Client</option><option value="admin">Admin</option></select></div>
            <div><label className="label">Starting credits ($)</label><input className="input" type="number" value={creating.credits} onChange={(e) => setCreating({ ...creating, credits: e.target.value })} /></div></div>
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit ${editing.email}`} onClose={() => setEditing(null)} footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={async () => {
          const body = { name: editing.name, organization: editing.organization, role: editing.role, active: editing.active, jobSite: editing.jobSite };
          if (editing.password) body.password = editing.password;
          if (await run(() => api(`/admin/users/${editing._id}`, { method: 'PATCH', body }), 'Saved.')) setEditing(null);
        }}>Save</button></>}>
          {['name', 'organization'].map((k) => <div key={k}><label className="label capitalize">{k}</label><input className="input" value={editing[k] || ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} /></div>)}
          <div className="grid grid-cols-2 gap-3"><div><label className="label">Role</label><select className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}><option value="client">Client</option><option value="admin">Admin</option></select></div>
            <div><label className="label">Status</label><select className="input" value={editing.active ? '1' : '0'} onChange={(e) => setEditing({ ...editing, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Disabled</option></select></div></div>
          <div className="border-t border-slate-200 pt-3"><div className="text-sm font-semibold text-brand-900 mb-2">Job site (commute distance is measured here)</div>
            <div className="space-y-2"><input className="input" placeholder="Label, e.g. Hancock Regional Hospital" value={editing.jobSite.label} onChange={(e) => setEditing({ ...editing, jobSite: { ...editing.jobSite, label: e.target.value } })} />
              <input className="input" placeholder="Street address (looked up automatically)" value={editing.jobSite.address} onChange={(e) => setEditing({ ...editing, jobSite: { ...editing.jobSite, address: e.target.value, lat: '', lon: '' } })} />
              <div className="grid grid-cols-2 gap-2"><input className="input" placeholder="Latitude" value={editing.jobSite.lat ?? ''} onChange={(e) => setEditing({ ...editing, jobSite: { ...editing.jobSite, lat: e.target.value } })} /><input className="input" placeholder="Longitude" value={editing.jobSite.lon ?? ''} onChange={(e) => setEditing({ ...editing, jobSite: { ...editing.jobSite, lon: e.target.value } })} /></div></div></div>
          <div><label className="label">Set a new password (optional)</label><input className="input" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></div>
          <button className="btn-secondary w-full" onClick={async () => { await run(() => api(`/admin/users/${editing._id}`, { method: 'PATCH', body: { grantExtraRun: true } }), 'One extra current-staff run granted for this month.'); }}>Grant one extra staff run this month</button>
        </Modal>
      )}
    </div>
  );
}
