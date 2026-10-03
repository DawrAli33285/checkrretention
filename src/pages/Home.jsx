import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Users, ArrowRight } from 'lucide-react';
import { api, fmtDateTime, money } from '../lib/api';
import { useSession } from '../lib/session';
import { PageHeader, StatusPill } from '../components/ui';

function Card({ to, icon: Icon, title, text, meta }) {
  return (
    <Link to={to} className="card p-6 flex gap-4 hover:border-brand-500 hover:shadow-md transition group">
      <div className="h-12 w-12 shrink-0 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center"><Icon size={22} /></div>
      <div className="flex-1">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-brand-900">{title}</h2><ArrowRight size={18} className="text-slate-300 group-hover:text-brand-500" /></div>
        <p className="text-sm text-slate-600 mt-1">{text}</p>
        <p className="text-xs text-slate-400 mt-3">{meta}</p>
      </div>
    </Link>
  );
}

export default function Home() {
  const { user, config } = useSession();
  const [jobs, setJobs] = useState([]);
  useEffect(() => { api('/jobs').then((d) => setJobs(d.jobs)).catch(() => {}); }, []);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const usedCurrent = jobs.some((j) => j.type === 'current' && j.period === thisMonth && j.status !== 'cancelled');
  const price = config?.pricePerRecord || {};
  return (
    <div>
      <PageHeader title={`Welcome${user.name ? `, ${user.name}` : ''}`} subtitle={`Available credits: ${money(user.credits)}`} />
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <Card to="/upload/prehire" icon={UserPlus} title="Pre-Hire" text="Upload an applicant list. Each candidate is scored once to support the hire decision." meta={price.prehire ? `${money(price.prehire)} per candidate` : 'Included'} />
        <Card to="/upload/current" icon={Users} title="Current Staff" text="Upload this month's staff snapshot to see who is likely to stay, who to watch, and who is at risk." meta={`${money(price.current)} per employee · ${config?.enforceMonthlyLimit ? (usedCurrent ? 'This month\'s run is used' : '1 run per month') : 'No monthly limit'}`} />
      </div>
      <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-brand-900">Recent runs</h2><Link to="/jobs" className="text-sm text-brand-500 hover:underline">All results</Link></div>
      {jobs.length === 0 ? <div className="card p-6 text-sm text-slate-500">No uploads yet. Start with a Pre-Hire or Current Staff file above. Sample files are available on the upload page.</div> : (
        <div className="card divide-y divide-slate-100">
          {jobs.slice(0, 5).map((j) => (
            <Link key={j._id} to={`/jobs/${j._id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <div className="min-w-0"><div className="text-sm font-medium text-slate-800 truncate">{j.fileName}</div><div className="text-xs text-slate-500">{j.type === 'prehire' ? 'Pre-hire' : 'Current staff'} · {fmtDateTime(j.createdAt)} · {j.counts.scored} records{j.providerMode === 'demo' ? ' · demo' : ''}</div></div>
              <StatusPill status={j.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
