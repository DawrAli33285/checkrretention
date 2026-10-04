import { AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  error: ['bg-red-50 border-red-200 text-red-800', XCircle],
  warning: ['bg-amber-50 border-amber-200 text-amber-900', AlertTriangle],
  info: ['bg-sky-50 border-sky-200 text-sky-900', Info],
  success: ['bg-emerald-50 border-emerald-200 text-emerald-900', CheckCircle2],
};

export function Notice({ tone = 'info', children, className = '' }) {
  const [cls, Icon] = TONES[tone] || TONES.info;
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${cls} ${className}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-brand-900';
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

const STATUS = {
  queued: 'bg-slate-100 text-slate-700', processing: 'bg-sky-100 text-sky-800', completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800', cancelled: 'bg-slate-100 text-slate-500',
  Paid: 'bg-emerald-100 text-emerald-800', Unpaid: 'bg-amber-100 text-amber-800', Void: 'bg-slate-100 text-slate-500',
};
export function StatusPill({ status }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS[status] || 'bg-slate-100 text-slate-700'}`}>{status}</span>;
}

export const BAND_STYLE = {
  'Likely to stay': 'bg-emerald-100 text-emerald-800',
  Watch: 'bg-amber-100 text-amber-800',
  'At risk': 'bg-red-100 text-red-800',
};
export function BandPill({ band }) {
  if (!band) return <span className="text-slate-400 text-xs">-</span>;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BAND_STYLE[band]}`}>{band}</span>;
}

// Domain pressure 1-10: 1 = no pressure found. Colours follow risk, not "score".
export function PressureChip({ label, value }) {
  const cls = value == null ? 'bg-slate-100 text-slate-400' : value >= 7 ? 'bg-red-100 text-red-800' : value >= 4 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${cls}`} title={value == null ? 'No signal' : `Pressure ${value}/10`}>{label}<b>{value ?? '–'}</b></span>;
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 font-semibold text-brand-900">{title}</div>
        <div className="p-5 space-y-3">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="card p-10 text-center text-sm text-slate-500">{children}</div>;
}
