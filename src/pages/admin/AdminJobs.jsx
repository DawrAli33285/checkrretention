import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime, money } from '../../lib/api';
import { Notice, PageHeader, StatusPill } from '../../components/ui';
import AdminNav from './AdminNav';

export default function AdminJobs() {
  const [jobs, setJobs] = useState([]); const [status, setStatus] = useState(''); const [msg, setMsg] = useState(null);
  const load = () => api(`/admin/jobs${status ? `?status=${status}` : ''}`).then((d) => setJobs(d.jobs));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const resume = async (j) => { try { await api(`/admin/jobs/${j._id}/resume`, { method: 'POST' }); setMsg({ tone: 'success', text: 'Resumed. Open the run to continue processing.' }); load(); } catch (e) { setMsg({ tone: 'error', text: e.message }); } };
  return (
    <div>
      <PageHeader title="All runs" actions={<select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['queued', 'processing', 'completed', 'failed', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select>} />
      <AdminNav />
      {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
      <div className="card overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Client</th><th className="th">File</th><th className="th">Type</th><th className="th">Uploaded</th><th className="th text-right">Done</th><th className="th text-right">Cost</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{jobs.map((j) => (
          <tr key={j._id}>
            <td className="td text-xs">{j.user?.email}<div className="text-slate-400">{j.user?.organization}</div></td>
            <td className="td"><Link className="text-brand-600 hover:underline" to={`/jobs/${j._id}`}>{j.fileName}</Link>{j.providerMode === 'demo' && <span className="ml-1 text-[10px] font-bold text-amber-700">DEMO</span>}{j.error && <div className="text-xs text-red-600">{j.error}</div>}</td>
            <td className="td">{j.type === 'prehire' ? 'Pre-hire' : 'Staff'}</td>
            <td className="td whitespace-nowrap text-xs">{fmtDateTime(j.createdAt)}</td>
            <td className="td text-right">{j.counts.done}/{j.counts.scored}</td>
            <td className="td text-right">{money(j.cost)}</td>
            <td className="td"><StatusPill status={j.status} /></td>
            <td className="td">{['failed', 'processing'].includes(j.status) && <button className="text-brand-600 text-sm hover:underline" onClick={() => resume(j)}>Resume</button>}</td>
          </tr>))}</tbody></table></div>
    </div>
  );
}
