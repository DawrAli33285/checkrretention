// Small, dependency-free chart pieces used on the results screens.
// Colors follow the outlook (red / amber / green) and always ship with a text
// label, so meaning never depends on color alone.
import { BAND_COLOR, BAND_ORDER, signed } from '../lib/explain';

/** Hover tooltip. Wrap any mark; the hit area is the wrapper. */
export function Tip({ text, children, className = '', block }) {
  const Tag = block ? 'div' : 'span';
  return (
    <Tag className={`relative group ${className}`}>
      {children}
      {text && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover:block">
          {text}
        </span>
      )}
    </Tag>
  );
}

/** One horizontal bar split into outlook segments (2px gaps between fills). */
export function OutlookBar({ counts, total, height = 'h-4', onSelect, showLabels }) {
  const parts = BAND_ORDER.map((b) => ({ band: b, n: counts[b] || 0 })).filter((p) => p.n > 0);
  if (!total) return <div className={`${height} rounded-full bg-slate-100`} />;
  return (
    <div>
      <div className={`flex ${height} w-full gap-0.5`}>
        {parts.map((p, i) => (
          <div key={p.band} style={{ width: `${(p.n / total) * 100}%`, minWidth: 6 }}>
            <Tip block className="h-full" text={`${p.band}: ${p.n} of ${total} (${Math.round((p.n / total) * 100)}%)`}>
              {onSelect ? (
                <button
                  type="button"
                  aria-label={`${p.band}: ${p.n}`}
                  onClick={() => onSelect(p.band)}
                  className={`block h-full w-full cursor-pointer hover:opacity-80 ${i === 0 ? 'rounded-l-full' : ''} ${i === parts.length - 1 ? 'rounded-r-full' : ''}`}
                  style={{ background: BAND_COLOR[p.band] }}
                />
              ) : (
                <span
                  className={`block h-full w-full ${i === 0 ? 'rounded-l-full' : ''} ${i === parts.length - 1 ? 'rounded-r-full' : ''}`}
                  style={{ background: BAND_COLOR[p.band] }}
                />
              )}
            </Tip>
          </div>
        ))}
      </div>
      {showLabels && (
        <div className="mt-2 flex w-full gap-0.5 text-xs text-slate-600">
          {parts.map((p) => (
            <div key={p.band} style={{ width: `${(p.n / total) * 100}%`, minWidth: 6 }} className="truncate pr-2">
              <span className="font-semibold text-slate-800">{Math.round((p.n / total) * 100)}%</span> {p.band}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Points bar that grows left (negative, red) or right (positive, green) from a center line. */
export function PointsBar({ value, max = 15, height = 'h-3' }) {
  const w = Math.min(100, (Math.abs(value) / max) * 100);
  return (
    <div className={`relative ${height} w-full`}>
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-300" />
      {value !== 0 && (
        <div
          className={`absolute top-0 h-full ${value < 0 ? 'right-1/2 rounded-l bg-red-500' : 'left-1/2 rounded-r bg-emerald-500'}`}
          style={{ width: `${w / 2}%` }}
        />
      )}
    </div>
  );
}

const SCALE_MIN = -40;
const SCALE_MAX = 60;
const posOf = (v) => ((Math.max(SCALE_MIN, Math.min(SCALE_MAX, v)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;

/** The outlook scale with a marker where this score lands. */
export function ScoreScale({ score, watchMin = 0, stayMin = 20 }) {
  const z0 = posOf(watchMin); const z1 = posOf(stayMin);
  const p = posOf(score);
  return (
    <div className="pt-9 pb-1">
      <div className="relative">
        <div className="absolute -top-9 -translate-x-1/2 text-center" style={{ left: `${p}%` }}>
          <div className="rounded-md bg-brand-900 px-2 py-0.5 text-sm font-bold text-white shadow">{signed(score)}</div>
          <div className="mx-auto h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-brand-900" />
        </div>
        <div className="flex h-3 w-full gap-0.5">
          <div className="h-full rounded-l-full" style={{ width: `${z0}%`, background: '#fecaca' }} />
          <div className="h-full" style={{ width: `${z1 - z0}%`, background: '#fde68a' }} />
          <div className="h-full flex-1 rounded-r-full" style={{ background: '#a7f3d0' }} />
        </div>
        <div className="absolute top-[-2px] h-4 w-4 -translate-x-1/2 rounded-full border-[3px] border-white bg-brand-900 shadow" style={{ left: `${p}%` }} />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-slate-500">
        <span className="absolute left-0">At risk</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${z0}%` }}>0</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(z0 + z1) / 2}%` }}>Watch</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${z1}%` }}>20</span>
        <span className="absolute right-0">Likely to stay</span>
      </div>
    </div>
  );
}

/** Compact score marker for table rows. */
export function MiniScale({ score, band }) {
  const p = posOf(score);
  return (
    <Tip text={`${signed(score)} points: ${band}`} className="block">
      <div className="relative h-1.5 w-24">
        <div className="flex h-full gap-px">
          <div className="h-full rounded-l-full bg-red-200" style={{ width: `${posOf(0)}%` }} />
          <div className="h-full bg-amber-200" style={{ width: `${posOf(20) - posOf(0)}%` }} />
          <div className="h-full flex-1 rounded-r-full bg-emerald-200" />
        </div>
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${p}%`, background: BAND_COLOR[band] || '#64748b' }} />
      </div>
    </Tip>
  );
}

/** Simple horizontal value bar (single series, brand color). */
export function ValueBar({ value, max, color = '#1867a5', height = 'h-2.5' }) {
  const w = max ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className={`${height} w-full rounded-r bg-slate-100`}>
      <div className={`${height} rounded-r`} style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

/** Small segmented toggle used above charts. */
export function Toggle({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={`rounded-md px-2.5 py-1 transition ${value === k ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
      ))}
    </div>
  );
}

export function LegendDots() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {BAND_ORDER.map((b) => <span key={b} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BAND_COLOR[b] }} />{b}</span>)}
    </div>
  );
}
