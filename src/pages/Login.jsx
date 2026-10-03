import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, ServerCrash } from 'lucide-react';
import { useSession } from '../lib/session';
import { api } from '../lib/api';
import { BRAND } from '../lib/brand';
import { Logo } from '../components/Shell';
import { Notice } from '../components/ui';

function Field({ id, label, ...props }) {
  return <div><label className="label" htmlFor={id}>{label}</label><input id={id} className="input" {...props} /></div>;
}

function Unavailable({ problem, onRetry }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-brand-900"><ServerCrash size={22} /><h2 className="text-xl font-semibold">The app is not connected yet</h2></div>
      <Notice tone="warning">{problem || 'The server did not respond.'}</Notice>
      <div className="text-sm text-slate-600 space-y-2">
        <p>This usually means the database is not set up. For whoever deploys the app:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Set <code className="text-xs bg-slate-100 px-1 rounded">MONGODB_URI</code> to a MongoDB Atlas connection string.</li>
          <li>In MongoDB Atlas, allow connections from anywhere (Network Access, 0.0.0.0/0) so the hosting servers can reach it.</li>
          <li>Redeploy, then open <code className="text-xs bg-slate-100 px-1 rounded">/api/health</code> to confirm it says connected.</li>
        </ol>
      </div>
      <button className="btn-secondary" onClick={onRetry}><RefreshCw size={16} />Try again</button>
    </div>
  );
}

function FirstRunSetup() {
  const { completeSetup, config } = useSession();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', organization: '', email: '', password: '', confirm: '', setupKey: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (f.password !== f.confirm) return setError('Passwords do not match.');
    setBusy(true);
    try { await completeSetup({ name: f.name, organization: f.organization, email: f.email, password: f.password, setupKey: f.setupKey }); navigate('/admin'); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-brand-900">Welcome. Create the administrator account</h2>
        <p className="text-sm text-slate-500 mt-1">This appears only once, on a new installation. The administrator adds client accounts and credits.</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field id="name" label="Your name" value={f.name} onChange={set('name')} autoComplete="name" />
        <Field id="org" label="Company" value={f.organization} onChange={set('organization')} autoComplete="organization" />
      </div>
      <Field id="email" label="Email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" />
      <Field id="pw" label="Password (10+ characters)" type="password" required minLength={10} value={f.password} onChange={set('password')} autoComplete="new-password" />
      <Field id="pw2" label="Confirm password" type="password" required minLength={10} value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
      {config?.setupKeyRequired && <Field id="setupKey" label="Setup key (from whoever deployed the app)" type="password" required value={f.setupKey} onChange={set('setupKey')} autoComplete="off" />}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create administrator account'}</button>
    </form>
  );
}

function SignIn() {
  const { login, config, expired } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // login | forgot | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') { const u = await login(email, password); navigate(u.role === 'admin' ? '/admin' : '/'); return; }
      if (mode === 'forgot') { const r = await api('/auth/forgot', { method: 'POST', body: { email } }); setMessage(r.message); }
      if (mode === 'register') { await api('/auth/register', { method: 'POST', body: { email, password } }); location.assign('/'); return; }
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const title = { login: 'Sign in', forgot: 'Reset your password', register: 'Create an account' }[mode];
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-2xl font-semibold text-brand-900">{title}</h2>
      {expired && mode === 'login' && <Notice tone="warning">Your session ended. Please sign in again.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== 'forgot' && <Field id="pw" label="Password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'forgot' ? 'Email me a reset link' : 'Create account'}</button>
      <div className="flex justify-between text-sm">
        {mode !== 'login' && <button type="button" className="text-brand-500 hover:underline" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Back to sign in</button>}
        {mode === 'login' && config?.mailEnabled && <button type="button" className="text-brand-500 hover:underline" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button>}
        {mode === 'login' && config?.allowSelfRegister && <button type="button" className="text-brand-500 hover:underline ml-auto" onClick={() => { setMode('register'); setError(''); }}>Create account</button>}
      </div>
      {mode === 'login' && !config?.mailEnabled && <p className="text-xs text-slate-500">Forgot your password? Ask your administrator to reset it.</p>}
    </form>
  );
}

export default function Login() {
  const { user, status, problem, config, reload } = useSession();
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace />;
  let panel;
  if (status === 'loading') panel = <div className="flex items-center justify-center gap-2 text-slate-500 py-10"><Loader2 className="animate-spin" size={18} />Loading…</div>;
  else if (status === 'unavailable') panel = <Unavailable problem={problem} onRetry={reload} />;
  else if (config?.needsSetup) panel = <FirstRunSetup />;
  else panel = <SignIn />;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand-900 p-12 text-white">
        <Logo light />
        <div>
          <h1 className="text-4xl font-semibold leading-tight">Know who is likely to stay<br />before it shows up in turnover.</h1>
          <p className="mt-4 text-blue-100 max-w-md">Score pre-hire candidates and current staff on commute, tenure, job-class turnover and four pressure domains drawn from public social signals.</p>
        </div>
        <p className="text-sm text-blue-200">{BRAND.tagline}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><Logo /></div>
          {panel}
        </div>
      </div>
    </div>
  );
}
