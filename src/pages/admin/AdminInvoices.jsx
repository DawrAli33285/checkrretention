import { useEffect, useState } from 'react';
import { api, fmtDate, money } from '../../lib/api';
import { Modal, Notice, PageHeader, StatusPill } from '../../components/ui';
import AdminNav from './AdminNav';

export default function AdminInvoices() {
  const [list, setList] = useState([]); const [users, setUsers] = useState([]); const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(null);
  const load = () => api('/admin/invoices').then((d) => setList(d.invoices));
  useEffect(() => { load(); api('/admin/users').then((d) => setUsers(d.users.filter((u) => u.role === 'client'))); }, []);
  const act = async (path, ok) => { try { await api(path, { method: 'POST' }); setMsg({ tone: 'success', text: ok }); load(); } catch (e) { setMsg({ tone: 'error', text: e.message }); } };
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Marking an invoice paid adds its amount to the client's credits." actions={<button className="btn-primary" onClick={() => setForm({ userId: users[0]?._id || '', amount: '', description: '', email: true })}>New invoice</button>} />
      <AdminNav />
      {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
      <div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Client</th><th className="th text-right">Amount</th><th className="th">Created</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{list.map((i) => (
          <tr key={i._id}>
            <td className="td">#{String(i._id).slice(-8).toUpperCase()}<div className="text-xs text-slate-500">{i.description}</div></td>
            <td className="td text-sm">{i.user?.email}</td>
            <td className="td text-right">{money(i.amount)}</td>
            <td className="td text-xs">{fmtDate(i.createdAt)}{i.paidAt && ` · paid ${fmtDate(i.paidAt)}`}</td>
            <td className="td"><StatusPill status={i.status} /></td>
            <td className="td whitespace-nowrap space-x-2 text-right">{i.status === 'Unpaid' && <><button className="text-brand-600 text-sm hover:underline" onClick={() => act(`/admin/invoices/${i._id}/paid`, 'Marked paid and credits added.')}>Mark paid</button><button className="text-slate-500 text-sm hover:underline" onClick={() => act(`/admin/invoices/${i._id}/void`, 'Invoice voided.')}>Void</button></>}</td>
          </tr>))}</tbody></table></div>
      {form && (
        <Modal title="New invoice" onClose={() => setForm(null)} footer={<><button className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" onClick={async () => { try { const r = await api('/admin/invoices', { method: 'POST', body: { ...form, amount: Number(form.amount) } }); setMsg({ tone: 'success', text: r.emailed ? 'Invoice created and emailed.' : 'Invoice created (email not sent: SMTP not configured or disabled).' }); setForm(null); load(); } catch (e) { setMsg({ tone: 'error', text: e.message }); } }}>Create</button></>}>
          <div><label className="label">Client</label><select className="input" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>{users.map((u) => <option key={u._id} value={u._id}>{u.email}{u.organization ? ` (${u.organization})` : ''}</option>)}</select></div>
          <div><label className="label">Amount ($)</label><input className="input" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} />Email the client</label>
        </Modal>
      )}
    </div>
  );
}
