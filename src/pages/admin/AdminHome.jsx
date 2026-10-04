import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime, money } from '../../lib/api';
import { Notice, PageHeader, Stat, StatusPill } from '../../components/ui';
import AdminNav from './AdminNav';

export default function AdminHome() {
  const [s, setS] = useState(null); const [sys, setSys] = useState(null);
  useEffect(() => { api('/admin/stats').then(setS).catch(() => {}); api('/admin/system').then(setSys).catch(() => {}); }, []);
  return (
    <div>
      <PageHeader title="Admin" />
      <AdminNav />
      {sys && (
        <div className="card p-4 mb-6 text-sm grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <div>Data mode: <strong className={sys.providerMode === 'demo' ? 'text-amber-700' : 'text-emerald-700'}>{sys.providerMode}</strong> (setting: {sys.providerSetting})</div>
          <div>People Data Labs key: {sys.keys.peopleDataLabs ? 'set' : 'missing'} · RapidAPI key: {sys.keys.rapidApi ? 'set' : 'missing'}</div>
          <div>Email (SMTP): {sys.mail ? 'configured' : 'not configured'}</div>
          <div>Model v{sys.modelVersion} · age factor {sys.enableAgeFactor ? 'ON' : 'off'}</div>
          <div>Price: {money(sys.pricePerRecord.current)} staff / {money(sys.pricePerRecord.prehire)} pre-hire per record</div>
          <div>Monthly limit: {sys.enforceMonthlyLimit ? 'enforced' : 'off'} · data kept {sys.dataRetentionDays} days</div>
          {sys.defaultJobSite?.lat == null && <div className="sm:col-span-2 lg:col-span-3"><Notice tone="warning">No default job site is set (JOB_SITE_LAT / JOB_SITE_LON). Set one per client under Clients & users, or distance will only come from a "Distance (Miles)" column.</Notice></div>}
        </div>
      )}
      {s && (<>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Clients" value={s.users} /><Stat label="Runs (all time)" value={s.jobs} /><Stat label="Runs, 30 days" value={s.jobs30} /><Stat label="Records scored, 30 days" value={s.records30} /><Stat label="Billed, 30 days" value={money(s.revenue30)} />
        </div>
        <div className="card divide-y divide-slate-100">
          <div className="px-4 py-3 font-semibold text-sm text-brand-900">Latest runs</div>
          {s.recent.map((j) => <Link key={j._id} to={`/jobs/${j._id}`} className="flex justify-between px-4 py-2 hover:bg-slate-50 text-sm"><span className="truncate">{j.user?.email} · {j.fileName}</span><span className="flex items-center gap-2 text-xs text-slate-500">{fmtDateTime(j.createdAt)}<StatusPill status={j.status} /></span></Link>)}
        </div>
      </>)}
    </div>
  );
}
