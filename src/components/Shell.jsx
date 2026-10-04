import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck, FlaskConical } from 'lucide-react';
import { useSession } from '../lib/session';
import { BRAND } from '../lib/brand';
import { money } from '../lib/api';

const navCls = ({ isActive }) => `px-3 py-2 rounded-md text-sm font-medium ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:text-white hover:bg-white/10'}`;

export function Logo({ light }) {
  return (
    <Link to="/" className="flex items-center gap-2">
      {BRAND.logoUrl ? <img src={BRAND.logoUrl} alt={BRAND.name} className="h-8 w-auto" /> : (
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill={light ? '#ffffff22' : '#102f4f'} /><path d="M8 20l5-6 4 3 7-8" stroke="#7cc4ff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
      <span className={`font-semibold tracking-tight ${light ? 'text-white' : 'text-brand-900'}`}>{BRAND.name}</span>
      <span className={`hidden sm:inline text-sm ${light ? 'text-blue-200' : 'text-slate-500'}`}>{BRAND.product}</span>
    </Link>
  );
}

export function DemoBanner() {
  const { config } = useSession();
  if (config?.providerMode !== 'demo') return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2">
        <FlaskConical size={16} className="shrink-0" />
        <span><strong>Demo mode.</strong> Social signals are simulated because no People Data Labs / RapidAPI keys are set. Scores show the full process but do not describe the real people in your file.</span>
      </div>
    </div>
  );
}

export default function Shell({ children }) {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-900">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Logo light />
            <nav className="hidden md:flex items-center gap-1">
              <NavLink to="/" end className={navCls}>Home</NavLink>
              <NavLink to="/jobs" className={navCls}>Results</NavLink>
              <NavLink to="/invoices" className={navCls}>Invoices</NavLink>
              {user?.role === 'admin' && <NavLink to="/admin" className={navCls}><span className="inline-flex items-center gap-1"><ShieldCheck size={14} />Admin</span></NavLink>}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user?.role !== 'admin' && <span className="hidden sm:inline rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">Credits {money(user?.credits)}</span>}
            <Link to="/account" className="text-sm text-blue-100 hover:text-white max-w-[160px] truncate">{user?.email}</Link>
            <button className="text-blue-100 hover:text-white" title="Sign out" onClick={async () => { await logout(); navigate('/login'); }}><LogOut size={18} /></button>
          </div>
        </div>
        <nav className="md:hidden flex gap-1 px-2 pb-2 overflow-x-auto">
          <NavLink to="/" end className={navCls}>Home</NavLink>
          <NavLink to="/jobs" className={navCls}>Results</NavLink>
          <NavLink to="/invoices" className={navCls}>Invoices</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin" className={navCls}>Admin</NavLink>}
        </nav>
      </header>
      <DemoBanner />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
      <footer className="text-center text-xs text-slate-400 py-4">{BRAND.name} · {BRAND.tagline}</footer>
    </div>
  );
}
