import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime, money } from '../lib/api';
import { Empty, PageHeader, StatusPill } from '../components/ui';

export default function Jobs() {
  const [jobs, setJobs] = useState(null);
  useEffect(() => { api('/jobs').then((d) => setJobs(d.jobs)).catch(() => setJobs([])); }, []);
  return (
    <div>
      <PageHeader title="Results" subtitle="Every upload and its status. Results are kept for 90 days by default." actions={<><Link className="btn-secondary" to="/upload/prehire">New pre-hire run</Link><Link className="btn-primary" to="/upload/current">New staff run</Link></>} />
      {!jobs ? <p className="text-sm text-slate-500">Loading…</p> : jobs.length === 0 ? <Empty>No runs yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">File</th><th className="th">Type</th><th className="th">Uploaded</th><th className="th text-right">Scored</th><th className="th text-right">Cost</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{jobs.map((j) => (
              <tr key={j._id} className="hover:bg-slate-50">
                <td className="td"><Link className="text-brand-600 font-medium hover:underline" to={`/jobs/${j._id}`}>{j.fileName}</Link>{j.providerMode === 'demo' && <span className="ml-2 text-[10px] font-bold uppercase text-amber-700">demo</span>}</td>
                <td className="td">{j.type === 'prehire' ? 'Pre-hire' : 'Current staff'}</td>
                <td className="td whitespace-nowrap">{fmtDateTime(j.createdAt)}</td>
                <td className="td text-right">{j.counts.done}/{j.counts.scored}</td>
                <td className="td text-right">{money(j.cost)}</td>
                <td className="td"><StatusPill status={j.status} /></td>
              </tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}
