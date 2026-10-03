import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Download, Eye, FileText, Fingerprint, Calculator, MessageSquareText, Search, ShieldCheck, Briefcase, Lightbulb, X } from 'lucide-react';
import { api, download, fmtDateTime, money } from '../lib/api';
import { useSession } from '../lib/session';
import { BandPill, Modal, Notice, PageHeader, PressureChip, StatusPill } from '../components/ui';
import { LegendDots, MiniScale, OutlookBar, PointsBar, ScoreScale, Tip, Toggle, ValueBar } from '../components/charts';
import { aggregate, DEFAULT_FINANCIAL, potentialLoss, shortMoney } from '../lib/financial';
import {
  BAND_COLOR, BAND_MEANING, BAND_ORDER, BAND_RANGE, driverStats, factorsFor, groupBy, journey, mainReason,
  nextStep, pct, signed, stressLabel, whySummary,
} from '../lib/explain';

const DOMAINS = [['financial', 'Financial', 'Fin'], ['schedule', 'Schedule', 'Sch'], ['workLife', 'Work-Life Balance', 'WLB'], ['communication', 'Communication', 'Com']];
const DOMAIN_LABEL = Object.fromEntries(DOMAINS.map(([k, l]) => [k, l]));
const SOURCE = { social: 'Public social posts', demo: 'Simulated (demo)', provided: 'Scores supplied in your file', none: 'No signal found' };
const BAND_ICON = { 'At risk': AlertTriangle, Watch: Eye, 'Likely to stay': ShieldCheck };
const BAND_TEXT = { 'At risk': 'text-red-700', Watch: 'text-amber-700', 'Likely to stay': 'text-emerald-700' };
const BAND_SOFT = { 'At risk': 'bg-red-50 border-red-200', Watch: 'bg-amber-50 border-amber-200', 'Likely to stay': 'bg-emerald-50 border-emerald-200' };

function SectionTitle({ title, sub, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-lg font-semibold text-brand-900">{title}</h2>
        {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function Progress({ job, activity, retrying }) {
  const p = job.counts.scored ? Math.round(((job.counts.done + job.counts.errors) / job.counts.scored) * 100) : 0;
  return (
    <div className="card p-6">
      <div className="flex justify-between items-end mb-3">
        <div><div className="text-sm text-slate-500">Scoring {job.counts.scored} records</div><div className="text-4xl font-bold text-brand-900">{p}%</div></div>
        <span className="text-sm text-slate-500">{job.counts.done + job.counts.errors} of {job.counts.scored} done</span>
      </div>
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-brand-500 transition-all duration-500" style={{ width: `${Math.max(p, 3)}%` }} /></div>
      {retrying && <p className="text-xs text-amber-700 mt-3">Connection interrupted. Retrying…</p>}
      {activity.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {activity.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex items-center justify-between py-1.5">
              <span className="text-slate-700 truncate">{a.name || '(no name)'}</span>
              <span className="flex items-center gap-2">{a.status === 'done' ? <><span className="text-xs text-slate-500">{signed(a.score)}</span><BandPill band={a.band} /></> : <span className="text-xs text-red-600">error</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500 mt-3">Keep this page open while it runs. If you close it, processing pauses and picks up where it left off when you return.</p>
    </div>
  );
}

/* ---------- 1. The three buckets ---------- */

function Buckets({ job, rows, fin, onPick }) {
  const done = rows.filter((r) => r.status === 'done');
  const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, done.filter((r) => r.band === b).length]));
  const avg = done.length ? done.reduce((a, r) => a + r.retentionScore, 0) / done.length : 0;
  const withSignal = done.filter((r) => ['social', 'demo', 'provided'].includes(r.socialSource)).length;
  const enableAge = !!job.settings?.enableAge;
  const exposure = { 'At risk': fin.atRiskExposure, Watch: fin.watchExposure };
  const meaning = BAND_MEANING[job.type === 'prehire' ? 'prehire' : 'current'];
  const who = job.type === 'prehire' ? 'candidates' : 'people';
  return (
    <section className="mb-6">
      <div className="card p-5 mb-4">
        <SectionTitle
          title={`Where your ${who} stand`}
          sub={`${done.length} ${who} scored. Each person lands in one of three groups based on their retention score. Click a color to see who is in it.`}
        />
        <OutlookBar counts={counts} total={done.length} height="h-5" showLabels onSelect={onPick} />
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {BAND_ORDER.map((b) => {
          const Icon = BAND_ICON[b];
          const group = done.filter((r) => r.band === b);
          const reason = mainReason(group, b, enableAge);
          return (
            <div key={b} className="card overflow-hidden flex flex-col">
              <div className="h-1.5" style={{ background: BAND_COLOR[b] }} />
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 font-semibold ${BAND_TEXT[b]}`}><Icon size={18} />{b}</div>
                  <span className="text-xs font-medium text-slate-400">{BAND_RANGE[b]}</span>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div className={`text-6xl font-bold leading-none tracking-tight ${BAND_TEXT[b]}`}>{counts[b]}</div>
                  <div className="pb-1 text-sm text-slate-500"><span className="text-lg font-semibold text-slate-800">{pct(counts[b], done.length)}%</span><br />of {who} scored</div>
                </div>
                <p className="mt-3 text-sm text-slate-700">{meaning[b]}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                  {b !== 'Likely to stay' && job.type !== 'prehire' ? (
                    <div><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Cost if they leave</div><div className="text-xl font-bold text-slate-900">{shortMoney(exposure[b] || 0)}</div></div>
                  ) : (
                    <div><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Average score</div><div className="text-xl font-bold text-slate-900">{group.length ? signed(Math.round(group.reduce((a, r) => a + r.retentionScore, 0) / group.length)) : '–'}</div></div>
                  )}
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{b === 'Likely to stay' ? 'What helps most' : 'What hurts most'}</div>
                    <div className="text-sm font-semibold text-slate-900 leading-snug">{reason ? reason.text.replace(/^(Top reason|Strongest): /, '').replace(/^./, (c) => c.toUpperCase()) : 'No single factor'}</div>
                    {reason && <div className="text-xs text-slate-500">avg {signed(reason.avg)} pts</div>}
                  </div>
                </div>
                <button type="button" disabled={!counts[b]} onClick={() => onPick(b)} className="mt-auto pt-4 inline-flex items-center gap-1 self-start text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:text-slate-300">
                  See the {counts[b]} {counts[b] === 1 ? (job.type === 'prehire' ? 'candidate' : 'person') : who} <ArrowRight size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        {[
          ['Scored', done.length, `${job.counts.skipped} set aside, ${job.counts.errors} errors`],
          ['Average score', signed(Math.round(avg)), avg >= 20 ? 'Likely to stay range' : avg >= 0 ? 'Watch range' : 'At risk range'],
          ['Stress signal found', `${pct(withSignal, done.length)}%`, `${withSignal} of ${done.length} ${who}`],
          job.type === 'prehire' ? ['Price per record', money(job.pricePerRecord), `${money(job.cost)} total`] : ['Avg. cost per exit', shortMoney(fin.avgLoss), fin.usesBenchmark ? 'includes industry benchmark' : 'from your figures'],
        ].map(([label, value, hint]) => (
          <div key={label} className="card px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className="text-2xl font-bold text-brand-900">{value}</div>
            <div className="text-xs text-slate-500">{hint}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- 2. What drives risk + where it sits ---------- */

function Drivers({ rows, enableAge }) {
  const done = rows.filter((r) => r.status === 'done');
  const [group, setGroup] = useState(done.some((r) => r.band === 'At risk') ? 'At risk' : 'all');
  const set = group === 'all' ? done : done.filter((r) => r.band === group);
  const stats = driverStats(set, enableAge).sort((a, b) => a.avg - b.avg);
  const max = Math.max(5, ...stats.map((s) => Math.abs(s.avg)));
  const worst = stats[0];
  const best = stats[stats.length - 1];
  return (
    <div className="card p-5">
      <SectionTitle
        title="What is driving the scores"
        sub="Average points each factor adds or takes away."
        right={<Toggle value={group} onChange={setGroup} options={[['At risk', 'At risk'], ['Watch', 'Watch'], ['all', 'Everyone']]} />}
      />
      {set.length === 0 ? <p className="text-sm text-slate-500 py-6 text-center">Nobody in this group.</p> : (
        <>
          <div className="hidden sm:flex items-center gap-3 mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <span className="w-44 shrink-0" />
            <div className="flex-1 grid grid-cols-2"><span className="text-right pr-3">◀ Lowers score</span><span className="pl-3">Raises score ▶</span></div>
            <span className="w-14 shrink-0" />
          </div>
          <ul className="space-y-2.5">
            {stats.map((s) => (
              <li key={s.key} className="flex items-center gap-3">
                <span className="w-28 sm:w-44 shrink-0 text-sm text-slate-700 truncate">{s.label}</span>
                <Tip block className="flex-1" text={`${s.label}: average ${signed(s.avg)} pts. ${s.negCount} of ${set.length} lose points here.`}>
                  <PointsBar value={s.avg} max={max} height="h-4" />
                </Tip>
                <span className={`w-14 shrink-0 text-right text-sm font-bold ${s.avg < 0 ? 'text-red-700' : s.avg > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{signed(s.avg)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 flex gap-2">
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-brand-500" />
            <span>
              {worst && worst.avg < 0 ? <>For {group === 'all' ? 'everyone scored' : `the ${group} group`}, <strong>{worst.label.toLowerCase()}</strong> costs the most ({signed(worst.avg)} points on average).</> : 'No factor is lowering scores on average.'}
              {best && best.avg > 0 && <> <strong>{best.label}</strong> helps the most ({signed(best.avg)}).</>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ByGroup({ rows, onPickGroup }) {
  const done = rows.filter((r) => r.status === 'done');
  const [by, setBy] = useState('department');
  const groups = groupBy(done, (r) => (by === 'department' ? r.department : r.jobClass)).slice(0, 10);
  return (
    <div className="card p-5">
      <SectionTitle
        title={`Outlook by ${by === 'department' ? 'department' : 'job class'}`}
        sub="Highest share at risk first. Click a row to filter the list."
        right={<Toggle value={by} onChange={setBy} options={[['department', 'Department'], ['jobClass', 'Job class']]} />}
      />
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.key}>
            <button type="button" onClick={() => onPickGroup(by, g.key)} className="w-full flex items-center gap-3 rounded-md px-1 py-1 hover:bg-slate-50 text-left">
              <span className="w-24 sm:w-36 shrink-0 text-sm text-slate-700 truncate" title={g.key}>{g.key}</span>
              <div className="flex-1"><OutlookBar counts={g} total={g.total} height="h-4" /></div>
              <span className="w-24 shrink-0 text-right text-xs text-slate-500"><strong className="text-sm text-red-700">{g['At risk']}</strong> of {g.total} at risk</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4"><LegendDots /></div>
    </div>
  );
}

/* ---------- 3. How we got these numbers ---------- */

function CoverageRow({ label, n, total, note }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-sm text-slate-700">{label}</span>
      <div className="flex-1"><ValueBar value={n} max={total} height="h-3" /></div>
      <span className="w-28 shrink-0 text-right text-sm"><strong className="text-slate-900">{pct(n, total)}%</strong> <span className="text-xs text-slate-500">({n} of {total})</span></span>
      {note && <span className="hidden lg:block w-48 text-xs text-slate-400">{note}</span>}
    </div>
  );
}

function Journey({ job, rows }) {
  const j = useMemo(() => journey(job, rows), [job, rows]);
  const [open, setOpen] = useState(null);
  const demo = job.providerMode === 'demo';
  const lookback = job.settings?.lookbackDays || 60;
  const done = rows.filter((r) => r.status === 'done');
  const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, done.filter((r) => r.band === b).length]));
  const who = job.type === 'prehire' ? 'candidates' : 'people';
  const steps = [
    {
      key: 'file', icon: FileText, n: j.fileRows, label: 'Rows in your file', sub: `${j.scored} scored, ${j.skipped} set aside`,
      body: (
        <div className="space-y-3">
          <p>We read every row of <strong>{job.fileName}</strong> and matched your column names to ours. <strong>{j.scored}</strong> {who} were scored. Rows that could not or should not be scored were set aside and <strong>not charged</strong>.</p>
          {Object.keys(j.reasons).length > 0 && (
            <ul className="grid sm:grid-cols-2 gap-2">
              {Object.entries(j.reasons).map(([k, n]) => <li key={k} className="flex justify-between rounded-md border border-slate-200 bg-white px-3 py-2"><span>{k}</span><strong>{n}</strong></li>)}
            </ul>
          )}
        </div>
      ),
    },
    {
      key: 'match', icon: Fingerprint, n: j.matched, label: 'Matched to public profiles', sub: `${pct(j.matched, j.scored)}% of ${who} scored`,
      body: (
        <div className="space-y-3">
          <p>Each person is looked up by email, phone and name to find their public social profiles. Matches below our confidence threshold are thrown out, so we never score the wrong person. <strong>{j.scored - j.matched}</strong> {who} had no confident match; their stress factors count as neutral (0 points), not as a negative.</p>
          <div className="space-y-2 max-w-xl">
            {Object.entries(j.networks).map(([k, n]) => <CoverageRow key={k} label={k} n={n} total={j.scored} />)}
          </div>
        </div>
      ),
    },
    {
      key: 'posts', icon: MessageSquareText, n: j.totalPosts, label: 'Recent posts read', sub: `from ${j.withPosts} ${who}`,
      body: <p>We read public posts from the last <strong>{lookback} days</strong>: {j.totalPosts} posts from {j.withPosts} {who}. Reshares of company pages are ignored. <strong>Post text is never stored</strong>, only the phrases that matched.{demo && ' In this demo run the posts are simulated.'}</p>,
    },
    {
      key: 'signals', icon: Search, n: j.withSignal + j.provided, label: 'Stress signals found', sub: `${j.phrases} phrase matches`,
      body: (
        <div className="space-y-2">
          <p>Posts are checked against a library of phrases in four areas: <strong>Financial, Schedule, Work-life balance and Communication</strong>. Each area gets a stress level from 1 (none) to 10 (heavy). Positive phrases such as "supportive manager" lower the level.</p>
          <p>{j.phrases} phrase matches produced stress levels for {j.withSignal} {who}{j.provided ? `, and ${j.provided} used scores supplied in your file` : ''}. Everyone else scores neutral in these areas.</p>
        </div>
      ),
    },
    {
      key: 'work', icon: Briefcase, n: j.coverage.tenure, label: 'Work data added', sub: 'commute, tenure, turnover',
      body: (
        <div className="space-y-3">
          <p>From your file we add commute distance to the job site, time on the job and how often people in the same job class leave. When a value is missing it scores neutral (0) and is noted on that person.</p>
          <div className="space-y-2">
            <CoverageRow label="Commute distance" n={j.coverage.distance} total={j.scored} note="miles from home to the job site" />
            <CoverageRow label={job.type === 'prehire' ? 'Time at current job' : 'Time on the job'} n={j.coverage.tenure} total={j.scored} note={job.type === 'prehire' ? 'from public work history' : 'from hire date'} />
            <CoverageRow label="Role turnover" n={j.coverage.turnover} total={j.scored} note={job.turnover?.length ? `${job.turnover.length} job classes measured from leavers in this file` : 'from your latest staff upload'} />
            <CoverageRow label="Stress signals" n={j.coverage.signal} total={j.scored} note="from public posts" />
          </div>
        </div>
      ),
    },
    {
      key: 'score', icon: Calculator, n: j.scored, label: `${job.type === 'prehire' ? 'Candidates' : 'People'} scored`, sub: `${counts['At risk']} at risk`,
      body: (
        <div className="space-y-3">
          <p>Each factor adds or takes away points. The total is the retention score, and the score sets the group: <strong>below 0 is At risk</strong>, <strong>0 to 19 is Watch</strong>, <strong>20 or more is Likely to stay</strong>. Points are a ranking, not a percentage or a probability.</p>
          <div className="max-w-xl"><OutlookBar counts={counts} total={j.scored} height="h-4" showLabels /></div>
        </div>
      ),
    },
  ];
  const sel = steps.find((s) => s.key === open);
  return (
    <section className="card p-5 mb-6">
      <SectionTitle title="How we got these numbers" sub="Six steps from your file to a score. Click any step for the detail." />
      <ol className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const active = open === s.key;
          return (
            <li key={s.key} className="relative">
              <button type="button" onClick={() => setOpen(active ? null : s.key)} className={`flex h-full w-full flex-col items-stretch justify-start rounded-xl border p-3 text-left transition ${active ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 bg-white hover:border-brand-500'}`}>
                <div className="flex items-center justify-between text-xs text-slate-400"><span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Icon size={14} /></span><span className="font-semibold">Step {i + 1}</span></div>
                <div className="mt-2 text-3xl font-bold text-brand-900">{s.n.toLocaleString('en-US')}</div>
                <div className="text-sm font-medium text-slate-800 leading-tight">{s.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.sub}</div>
                <div className="mt-auto pt-2 inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600">{active ? 'Hide' : 'Details'} {active ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</div>
              </button>
              {i < steps.length - 1 && <ArrowRight size={14} className="hidden xl:block absolute -right-[11px] top-1/2 -translate-y-1/2 text-slate-300 z-10" />}
            </li>
          );
        })}
      </ol>
      {sel && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{sel.body}</div>}
    </section>
  );
}

/* ---------- 4. Person detail (the drop-down) ---------- */

function Breakdown({ r, job }) {
  const enableAge = !!job.settings?.enableAge;
  const items = factorsFor(r, job.type, enableAge).sort((a, b) => a.points - b.points);
  const why = whySummary(r, job.type, enableAge);
  const steps = nextStep(r, job.type, enableAge);
  const max = Math.max(10, ...items.map((i) => Math.abs(i.points)));
  const live = job.providerMode !== 'demo';
  const profiles = Object.entries(r.profiles || {}).filter(([, v]) => v);
  const NET = { linkedin: 'LinkedIn', facebook: 'Facebook', twitter: 'X' };
  return (
    <div className="grid lg:grid-cols-5 gap-5 p-5 bg-slate-50 border-y border-slate-200">
      <div className="lg:col-span-3 space-y-4">
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where the score lands</h4>
          <ScoreScale score={r.retentionScore} />
          <div className="mt-3 text-sm text-slate-700 space-y-1">
            <p className="font-semibold text-slate-900">{why.lead}</p>
            <p><span className="text-red-700 font-medium">▼</span> {why.down}</p>
            <p><span className="text-emerald-700 font-medium">▲</span> {why.up}</p>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">How the score adds up</h4>
            <span className="text-xs text-slate-400">points per factor</span>
          </div>
          <ul className="space-y-2.5">
            {items.map((i) => (
              <li key={i.key} className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-5 min-w-0"><div className="text-sm font-medium text-slate-800">{i.label}</div><div className="text-xs text-slate-500 truncate" title={i.detail}>{i.detail}</div></div>
                <div className="col-span-5"><PointsBar value={i.points} max={max} /></div>
                <div className={`col-span-2 text-right text-sm font-bold ${i.points > 0 ? 'text-emerald-700' : i.points < 0 ? 'text-red-700' : 'text-slate-400'}`}>{signed(i.points)}</div>
              </li>
            ))}
            <li className="grid grid-cols-12 items-center gap-2 border-t border-slate-200 pt-2.5">
              <div className="col-span-10 text-sm font-semibold text-slate-900">Retention score</div>
              <div className="col-span-2 text-right text-base font-bold text-brand-900">{signed(r.retentionScore)}</div>
            </li>
          </ul>
        </div>
      </div>
      <div className="lg:col-span-2 space-y-4 text-sm">
        <div className={`rounded-xl border p-4 ${BAND_SOFT[r.band] || 'bg-white border-slate-200'}`}>
          <h4 className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${BAND_TEXT[r.band]}`}><Lightbulb size={14} />Suggested next step</h4>
          <ul className="mt-2 space-y-1.5 text-slate-800">{steps.map((s) => <li key={s} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />{s}</li>)}</ul>
        </div>
        <div className="card p-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where this came from</h4>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <dt className="text-slate-500">Stress signals</dt><dd className="font-medium text-slate-800">{SOURCE[r.socialSource] || '–'}</dd>
            <dt className="text-slate-500">Posts read</dt><dd className="font-medium text-slate-800">{r.postsConsidered} in the last {job.settings?.lookbackDays || 60} days</dd>
            <dt className="text-slate-500">Profile match</dt><dd className="font-medium text-slate-800">{profiles.length ? `Found${r.matchLikelihood ? `, confidence ${r.matchLikelihood}/10` : ''}` : 'No confident match'}</dd>
            {r.jobSatisfaction != null && <><dt className="text-slate-500">Job satisfaction</dt><dd className="font-medium text-slate-800">{r.jobSatisfaction}/10 stress (not scored)</dd></>}
          </dl>
          {profiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profiles.map(([k, v]) => (live
                ? <a key={k} href={v} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-brand-600 hover:bg-brand-50">{NET[k] || k}</a>
                : <span key={k} title={v} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600">{NET[k] || k}</span>))}
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Stress by area</div>
            <div className="grid grid-cols-2 gap-1.5">
              {DOMAINS.map(([k, label]) => {
                const v = r.domains?.[k];
                return (
                  <div key={k} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1">
                    <span className="text-xs text-slate-600">{label}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${v == null ? 'text-slate-400' : v >= 7 ? 'bg-red-100 text-red-800' : v >= 4 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{v == null ? 'No signal' : `${v}/10 ${stressLabel(v)}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {r.evidence?.length > 0 && (
          <div className="card p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Phrases that matched</h4>
            <div className="flex flex-wrap gap-1.5">
              {r.evidence.slice(0, 10).map((e, i) => (
                <span key={i} className={`rounded-full px-2.5 py-1 text-xs ${e.polarity === 'protective' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  “{e.phrase}” <span className="opacity-60">×{e.count} · {DOMAIN_LABEL[e.domain] || e.domain}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Red raises stress, green lowers it. Full post text is never stored.</p>
          </div>
        )}
        {r.flags?.length > 0 && (
          <div className="text-xs text-slate-500">
            <div className="font-semibold uppercase tracking-wide mb-1">Notes</div>
            <ul className="list-disc pl-4 space-y-0.5">{r.flags.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 5. Results list ---------- */

function ResultsTable({ rows, job, filters, setFilters }) {
  const { band, dept, cls } = filters;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const [q, setQ] = useState(''); const [showSkipped, setShowSkipped] = useState(false);
  const [open, setOpen] = useState(null); const [sort, setSort] = useState('score');
  const depts = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort(), [rows]);
  const classes = useMemo(() => [...new Set(rows.map((r) => r.jobClass).filter(Boolean))].sort(), [rows]);
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return rows.filter((r) => (showSkipped || r.status === 'done' || r.status === 'error')
      && (!dept || r.department === dept) && (!cls || r.jobClass === cls) && (!band || r.band === band)
      && (!s || `${r.name} ${r.email} ${r.employeeNumber}`.toLowerCase().includes(s)))
      .sort((a, b) => (sort === 'score' ? (a.retentionScore ?? 999) - (b.retentionScore ?? 999) : sort === 'scoreDesc' ? (b.retentionScore ?? -999) - (a.retentionScore ?? -999) : a.name.localeCompare(b.name)));
  }, [rows, q, dept, cls, band, showSkipped, sort]);
  const total = rows.filter((r) => r.status === 'done' || r.status === 'error').length;
  const filtered = band || dept || cls || q;
  return (
    <div className="card">
      <div className="p-3 flex flex-wrap gap-2 items-center border-b border-slate-200">
        <div className="relative"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><input className="input pl-7 w-48" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-auto" value={band} onChange={(e) => set('band', e.target.value)}><option value="">All outlooks</option>{BAND_ORDER.map((b) => <option key={b}>{b}</option>)}</select>
        <select className="input w-auto max-w-[200px]" value={dept} onChange={(e) => set('dept', e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="input w-auto max-w-[200px]" value={cls} onChange={(e) => set('cls', e.target.value)}><option value="">All job classes</option>{classes.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}><option value="score">Highest risk first</option><option value="scoreDesc">Most likely to stay first</option><option value="name">Name A-Z</option></select>
        {filtered && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline" onClick={() => { setQ(''); setFilters({ band: '', dept: '', cls: '' }); }}><X size={13} />Clear filters</button>}
        <label className="text-xs text-slate-600 flex items-center gap-1 ml-auto"><input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />Show set-aside rows</label>
      </div>
      <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100 bg-slate-50/60">Showing <strong className="text-slate-700">{list.length}</strong> of {total}. Click any row to see why they scored the way they did.</div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th w-6" /><th className="th">{job.type === 'prehire' ? 'Candidate' : 'Employee'}</th><th className="th">Department / Job class</th><th className="th text-right">Score</th><th className="th">Outlook</th><th className="th">Stress signals (1 low, 10 high)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((r) => (
              <Fragment key={r.id}>
                <tr className={`${open === r.id ? 'bg-brand-50/60' : 'hover:bg-slate-50'} ${r.status === 'done' ? 'cursor-pointer' : 'text-slate-400'}`} onClick={() => r.status === 'done' && setOpen(open === r.id ? null : r.id)}>
                  <td className="td">{r.status === 'done' && (open === r.id ? <ChevronDown size={16} className="text-brand-600" /> : <ChevronRight size={16} />)}</td>
                  <td className="td"><div className="font-medium text-slate-800">{r.name || '(no name)'}</div><div className="text-xs text-slate-500">{r.email || r.phone}{r.employeeNumber ? ` · #${r.employeeNumber}` : ''}</div></td>
                  <td className="td"><div>{r.department || '–'}</div><div className="text-xs text-slate-500">{r.jobClass}</div></td>
                  <td className="td">{r.status === 'done' && <div className="flex items-center justify-end gap-3"><MiniScale score={r.retentionScore} band={r.band} /><span className="w-9 text-right text-base font-bold text-slate-900">{signed(r.retentionScore)}</span></div>}</td>
                  <td className="td">{r.status === 'done' ? <BandPill band={r.band} /> : <span className="text-xs">{r.status === 'error' ? `Error: ${r.error}` : r.skipReason}</span>}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{r.status === 'done' && DOMAINS.map(([k, , short]) => <PressureChip key={k} label={short} value={r.domains?.[k]} />)}</div></td>
                </tr>
                {open === r.id && <tr><td colSpan={6} className="p-0"><Breakdown r={r} job={job} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No rows match these filters.</p>}
      </div>
    </div>
  );
}

/* ---------- 6. Financial impact ---------- */

function ExposureChart({ title, groups }) {
  const shown = groups.filter((g) => g.count).slice(0, 8);
  const max = Math.max(1, ...shown.map((g) => g.exposure));
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-brand-900 mb-4">Cost at risk by {title.toLowerCase()}</h3>
      <ul className="space-y-3">
        {shown.map((g) => (
          <li key={g.key}>
            <div className="flex justify-between text-sm mb-1"><span className="text-slate-700 truncate pr-2">{g.key}</span><span className="font-bold text-slate-900">{g.exposure ? shortMoney(g.exposure) : '$0'}</span></div>
            <Tip block text={`${g.key}: ${money(g.exposure)} if the ${g.atRisk} at-risk ${g.atRisk === 1 ? 'person leaves' : 'people leave'}`}>
              <ValueBar value={g.exposure} max={max} color="#dc2626" height="h-3" />
            </Tip>
            <div className="text-xs text-slate-500 mt-0.5">{g.atRisk} of {g.count} at risk</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PART_KEYS = ['replacement', 'vacancy', 'overtime', 'productivity'];
const PART_LABEL = { replacement: 'Replacement', vacancy: 'Vacancy', overtime: 'Overtime / contract', productivity: 'Lost productivity' };
const PART_COLOR = { replacement: '#102f4f', vacancy: '#1867a5', overtime: '#5fa8e0', productivity: '#9cc9ec' };

function Financial({ rows, cfg, setCfg }) {
  const a = useMemo(() => aggregate(rows, cfg), [rows, cfg]);
  const avgParts = useMemo(() => {
    const scored = rows.filter((r) => r.status === 'done');
    if (!scored.length) return [];
    const sums = Object.fromEntries(PART_KEYS.map((k) => [k, 0]));
    const src = Object.fromEntries(PART_KEYS.map((k) => [k, new Set()]));
    scored.forEach((r) => { const loss = potentialLoss(r, cfg); PART_KEYS.forEach((k) => { sums[k] += loss.parts[k].value; src[k].add(loss.parts[k].source); }); });
    return PART_KEYS.map((k) => ({ key: k, label: PART_LABEL[k], color: PART_COLOR[k], value: sums[k] / scored.length, source: [...src[k]].join(', ') }));
  }, [rows, cfg]);
  const avgTotal = avgParts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['People at risk', a.atRiskCount, `of ${a.scored} scored`, 'text-red-700'],
          ['Cost if at-risk people leave', shortMoney(a.atRiskExposure), `${a.atRiskCount} × avg ${shortMoney(a.atRiskCount ? a.atRiskExposure / a.atRiskCount : 0)}`, 'text-red-700'],
          ['Cost if Watch group leaves', shortMoney(a.watchExposure), `${a.watchCount} people`, 'text-amber-700'],
          ['Average cost per exit', shortMoney(a.avgLoss), a.usesBenchmark ? 'includes industry benchmark' : 'from your figures', 'text-brand-900'],
        ].map(([label, value, hint, color]) => (
          <div key={label} className="card p-5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className={`text-4xl font-bold mt-1 tracking-tight ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-1">{hint}</div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <SectionTitle title="What one exit costs" sub="Average cost to lose and replace one person, built from four parts. Your own figures are used when the file has them, otherwise the labelled benchmark." />
        <div className="flex h-8 w-full gap-0.5">
          {avgParts.filter((p) => p.value > 0).map((p, i, arr) => (
            <div key={p.key} style={{ width: `${(p.value / (avgTotal || 1)) * 100}%`, background: p.color }} className={`h-full ${i === 0 ? 'rounded-l-lg' : ''} ${i === arr.length - 1 ? 'rounded-r-lg' : ''}`}>
              <Tip block className="h-full w-full" text={`${p.label}: ${money(p.value)}`}><span className="flex h-full w-full items-center px-3 text-xs font-semibold text-white truncate" style={{ color: p.key === 'productivity' || p.key === 'overtime' ? '#102f4f' : '#fff' }}>{p.value / (avgTotal || 1) > 0.15 ? `${p.label} ${shortMoney(p.value)}` : ''}</span></Tip>
            </div>
          ))}
        </div>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {avgParts.map((p) => (
            <div key={p.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{p.value ? shortMoney(p.value) : '$0'}</div>
              <div className="text-[11px] text-slate-400">{p.source === 'unavailable' ? 'not in your file' : p.source.replace('client', 'your figures')}</div>
            </div>
          ))}
          <div className="rounded-lg bg-brand-900 p-3 text-white">
            <div className="text-xs text-blue-200">= Cost per exit</div>
            <div className="text-xl font-bold mt-1">{shortMoney(avgTotal)}</div>
            <div className="text-[11px] text-blue-200">average across everyone scored</div>
          </div>
        </div>
      </div>

      <Notice tone="info">These are <strong>costs if these people leave</strong>, not a forecast. The model ranks risk; it does not yet give a calibrated chance that someone will leave, so we do not multiply by a probability.</Notice>

      <div className="grid lg:grid-cols-2 gap-4">
        <ExposureChart title="Department" groups={a.byDepartment} />
        <ExposureChart title="Job class" groups={a.byJobClass} />
      </div>

      <details className="card p-4 text-sm"><summary className="cursor-pointer font-medium text-brand-600">Change the benchmark assumptions</summary>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <div><label className="label">Replacement cost min ($)</label><input className="input" type="number" value={cfg.benchmarkReplacementMin} onChange={(e) => setCfg({ ...cfg, benchmarkReplacementMin: Number(e.target.value) || 0 })} /></div>
          <div><label className="label">Replacement cost max ($)</label><input className="input" type="number" value={cfg.benchmarkReplacementMax} onChange={(e) => setCfg({ ...cfg, benchmarkReplacementMax: Number(e.target.value) || 0 })} /></div>
          <div><label className="label">Productivity disruption (% of salary)</label><input className="input" type="number" value={cfg.productivityPercentOfSalary} onChange={(e) => setCfg({ ...cfg, productivityPercentOfSalary: Number(e.target.value) || 0 })} /></div>
        </div>
        <p className="text-xs text-slate-500 mt-2">Add "Replacement Cost", "Vacancy Days", "Daily Loaded Labor Cost", "Overtime Cost" or "Annual Salary" columns to the upload to use your own figures instead. Every number on this page updates as you type.</p>
      </details>

      {a.atRisk.length > 0 && <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-slate-200 font-semibold text-brand-900">At-risk people and what each exit would cost</div>
        <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">Job class</th><th className="th text-right">Score</th><th className="th text-right">Cost if they leave</th><th className="th">Based on</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{[...a.atRisk].sort((x, y) => x.row.retentionScore - y.row.retentionScore).slice(0, 50).map(({ row, loss }) => <tr key={row.id}><td className="td font-medium text-slate-800">{row.name}</td><td className="td">{row.jobClass}</td><td className="td text-right font-semibold text-red-700">{signed(row.retentionScore)}</td><td className="td text-right font-semibold">{money(loss.total)}</td><td className="td text-xs text-slate-500">{Object.values(loss.parts).filter((p) => p.value).map((p) => p.label).join(' + ')}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

/* ---------- 7. How scores work ---------- */

function PointsTable({ rows, unit }) {
  const max = Math.max(5, ...rows.map((r) => Math.abs(r.points)));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-12 items-center gap-2 text-sm">
          <span className="col-span-4 text-slate-700">{unit ? `${unit} ${r.label}` : r.label}</span>
          <div className="col-span-6"><PointsBar value={r.points} max={max} /></div>
          <span className={`col-span-2 text-right font-semibold ${r.points > 0 ? 'text-emerald-700' : r.points < 0 ? 'text-red-700' : 'text-slate-400'}`}>{signed(r.points)}</span>
        </li>
      ))}
    </ul>
  );
}

function Method({ job, model }) {
  const enableAge = !!job.settings?.enableAge;
  const parts = ['Commute distance', job.type === 'prehire' ? 'Time at current job' : 'Time on the job', 'Role turnover', 'Financial', 'Schedule', 'Work-life balance', 'Communication', ...(enableAge ? ['Age'] : [])];
  const sections = [
    {
      key: 'distance', title: 'Commute distance', text: 'Miles from home to the job site. Points come from where your most stable staff live: distances where long-staying people cluster earn points, distances where few of them live lose points.',
      table: model?.distance,
    },
    {
      key: 'tenure', title: job.type === 'prehire' ? 'Time at current job' : 'Time on the job', text: `${job.type === 'prehire' ? 'How long the candidate has been at their current employer (from public work history).' : 'Months since hire date.'} Points follow the same idea: time windows where people tend to stay earn points, windows where people tend to leave lose points.`,
      table: model?.tenure,
    },
    {
      key: 'turnover', title: 'Turnover in their role', text: 'The share of people in the same job class who left in the last 12 months (not counting temp contract ends or transfers). Roles that rarely lose people earn points; roles that lose many people lose points.',
      table: model?.turnover,
    },
    {
      key: 'social', title: 'Stress signals: Financial, Schedule, Work-life balance, Communication', text: `Public posts from the last ${job.settings?.lookbackDays || 60} days are checked for stress phrases in each area. Each area gets a stress level from 1 (none) to 10 (heavy), which converts to points as below. No posts means 0 points, never a guess.`,
      table: model?.social, unit: 'Level',
    },
  ];
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <SectionTitle title="The retention score in one line" sub={`Model version ${job.modelVersion}. ${enableAge ? 'Age is included.' : 'Age is not used.'}`} />
        <div className="flex flex-wrap items-center gap-2">
          {parts.map((p, i) => (
            <Fragment key={p}>
              <span className={`rounded-lg px-3 py-2 text-sm font-medium ${i < 3 ? 'bg-brand-50 text-brand-900' : 'bg-slate-100 text-slate-700'}`}>{p}</span>
              <span className="text-slate-400 font-bold">{i < parts.length - 1 ? '+' : '='}</span>
            </Fragment>
          ))}
          <span className="rounded-lg bg-brand-900 px-3 py-2 text-sm font-bold text-white">Retention score</span>
        </div>
        <p className="mt-3 text-xs text-slate-500"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-100 mr-1 align-middle" />Work factors from your file <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-200 ml-3 mr-1 align-middle" />Stress signals from public posts</p>
        <div className="mt-6 max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-800">What the score means</h3>
          <ScoreScale score={job.type === 'prehire' ? 24 : 8} />
          <div className="grid sm:grid-cols-3 gap-3 mt-3 text-sm">
            {BAND_ORDER.map((b) => <div key={b} className={`rounded-lg border p-3 ${BAND_SOFT[b]}`}><div className={`font-semibold ${BAND_TEXT[b]}`}>{b}</div><div className="text-xs text-slate-500">{BAND_RANGE[b]}</div><div className="text-slate-700 mt-1">{BAND_MEANING[job.type === 'prehire' ? 'prehire' : 'current'][b]}</div></div>)}
          </div>
          <p className="text-xs text-slate-500 mt-3">Points are a ranking, not a percentage or a probability. The marker above is an example.</p>
        </div>
      </div>

      <div className="card divide-y divide-slate-100">
        {sections.map((s) => (
          <details key={s.key} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <span className="font-semibold text-brand-900">{s.title}</span>
              <ChevronRight size={18} className="text-slate-400 transition group-open:rotate-90" />
            </summary>
            <div className="mt-3 grid lg:grid-cols-2 gap-6">
              <p className="text-sm text-slate-700">{s.text}</p>
              {s.table ? <PointsTable rows={s.table} unit={s.unit} /> : <p className="text-sm text-slate-400">Point table unavailable.</p>}
            </div>
          </details>
        ))}
        {job.turnover?.length > 0 && (
          <details className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between"><span className="font-semibold text-brand-900">Turnover measured in this file</span><ChevronRight size={18} className="text-slate-400 transition group-open:rotate-90" /></summary>
            <div className="mt-3 grid lg:grid-cols-2 gap-6">
              <p className="text-sm text-slate-700">Calculated from {job.turnover.length} job classes in this upload: people who left in the last 12 months divided by average headcount. Job classes with fewer than 5 people use the organization-wide rate. This table is saved and reused for later pre-hire runs.</p>
              <ul className="space-y-2">
                {[...job.turnover].sort((a, b) => b.pct - a.pct).map((t) => (
                  <li key={t.jobClass}>
                    <div className="flex justify-between text-sm"><span className="text-slate-700">{t.jobClass}</span><span className="font-semibold text-slate-900">{t.pct}%</span></div>
                    <ValueBar value={t.pct} max={Math.max(30, ...job.turnover.map((x) => x.pct))} color={t.pct >= 25 ? '#dc2626' : '#1867a5'} />
                    <div className="text-xs text-slate-500">{t.separations} left, {t.headcount} active{t.usedOrgRate ? ' (organization rate used)' : ''}</div>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
        <div className="p-5 text-sm text-slate-700 space-y-2">
          <p><strong>Missing data</strong> (no address, unreadable hire date, unknown turnover) scores 0 for that factor and is listed in each person's notes. Nothing is estimated or randomized.</p>
          {job.type === 'prehire' && <p><strong>Pre-hire</strong>: tenure is the candidate's time at their current employer when available; turnover uses the job-class table from your latest staff upload.</p>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export default function JobView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [job, setJob] = useState(null);
  const [rows, setRows] = useState(null);
  const [model, setModel] = useState(null);
  const [tab, setTab] = useState('results');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [activity, setActivity] = useState([]);
  const [retrying, setRetrying] = useState(false);
  const [confirming, setConfirming] = useState(null); // 'cancel' | 'delete'
  const [filters, setFilters] = useState({ band: '', dept: '', cls: '' });
  const [cfg, setCfg] = useState(DEFAULT_FINANCIAL);
  const tabsRef = useRef(null);

  const loadResults = useCallback(async () => { const d = await api(`/jobs/${id}/results`); setJob(d.job); setRows(d.rows); setModel(d.model || null); }, [id]);

  // Drives processing: calls /step until the run finishes. Each effect run has its
  // own "stopped" flag, so leaving the page (or React re-running the effect) ends
  // exactly this loop and never leaves two loops running.
  useEffect(() => {
    let stopped = false;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        let { job: j } = await api(`/jobs/${id}`);
        if (stopped) return;
        setJob(j);
        let failures = 0;
        while (!stopped && ['queued', 'processing'].includes(j.status)) {
          try {
            const r = await api(`/jobs/${id}/step`, { method: 'POST' });
            if (stopped) return;
            failures = 0; setRetrying(false);
            j = r.job; setJob(j);
            if (r.recent?.length) setActivity((a) => [...r.recent.slice().reverse(), ...a].slice(0, 8));
            if (r.busy) await wait(3000); // another tab or server instance is working on it
          } catch (e) {
            if (e.status && e.status < 500) throw e;
            failures += 1; setRetrying(true);
            if (failures > 5) throw e;
            await wait(2000 * failures);
          }
        }
        if (!stopped) await loadResults();
      } catch (e) { if (!stopped) setError(e.message); }
    })();
    return () => { stopped = true; };
  }, [id, loadResults]);

  const fin = useMemo(() => (rows ? aggregate(rows, cfg) : null), [rows, cfg]);
  const scoredCount = rows ? rows.filter((r) => r.status === 'done').length : 0;

  if (error) return <Notice tone="error">{error} <Link to="/jobs" className="underline">Back to results</Link></Notice>;
  if (!job) return <p className="text-sm text-slate-500">Loading…</p>;

  const doConfirmed = async () => {
    const what = confirming; setConfirming(null); setActionError('');
    try {
      if (what === 'cancel') { await api(`/jobs/${id}/cancel`, { method: 'POST' }); await refresh(); await loadResults(); }
      if (what === 'delete') { await api(`/jobs/${id}`, { method: 'DELETE' }); navigate('/jobs'); }
    } catch (e) { setActionError(e.message); }
  };
  const safeDownload = async (path, name) => { setActionError(''); try { await download(path, name); } catch (e) { setActionError(e.message); } };
  const running = ['queued', 'processing'].includes(job.status);
  const jumpToList = (next) => {
    setFilters((f) => ({ ...f, ...next }));
    setTab('results');
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div>
      <PageHeader
        title={job.fileName}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{job.type === 'prehire' ? 'Pre-hire' : 'Current staff'} · uploaded {fmtDateTime(job.createdAt)} · {money(job.cost)} <StatusPill status={job.status} />{job.providerMode === 'demo' && <span className="rounded bg-amber-100 px-1.5 text-xs font-bold text-amber-800">DEMO DATA</span>}</span>}
        actions={running ? <button className="btn-danger" onClick={() => setConfirming('cancel')}>Stop run</button> : <>
          <button className="btn-secondary" onClick={() => safeDownload(`/jobs/${id}/export?format=csv`, 'results.csv')}><Download size={16} />CSV</button>
          <button className="btn-primary" onClick={() => safeDownload(`/jobs/${id}/export`, 'results.xlsx')}><Download size={16} />Excel report</button>
          {job.status === 'failed'
            ? <button className="btn-danger" onClick={() => setConfirming('cancel')}>Stop and refund</button>
            : <button className="btn-danger" onClick={() => setConfirming('delete')}>Delete</button>}
        </>}
      />
      {actionError && <Notice tone="error" className="mb-4">{actionError}</Notice>}
      {confirming && (
        <Modal title={confirming === 'cancel' ? 'Stop this run?' : 'Delete this run?'} onClose={() => setConfirming(null)}
          footer={<><button className="btn-secondary" onClick={() => setConfirming(null)}>Keep it</button><button className="btn-danger" onClick={doConfirmed}>{confirming === 'cancel' ? 'Stop run' : 'Delete run'}</button></>}>
          <p className="text-sm text-slate-600">{confirming === 'cancel' ? 'Records not yet scored will be refunded to your credits. Results already scored are kept.' : 'This permanently removes the run and all of its results.'}</p>
        </Modal>
      )}
      {job.status === 'failed' && <Notice tone="error" className="mb-4">This run paused: {job.error || 'unknown error'}. Your administrator can resume it, or choose Stop and refund to get credits back for records not yet scored.</Notice>}
      {job.issues?.length > 0 && <details className="mb-4"><summary className="text-sm text-slate-600 cursor-pointer">File notes ({job.issues.length})</summary><div className="mt-2 space-y-2">{job.issues.map((i, n) => <Notice key={n} tone={i.level === 'warning' ? 'warning' : 'info'}>{i.message}</Notice>)}</div></details>}
      {running && <Progress job={job} activity={activity} retrying={retrying} />}
      {!running && rows && fin && scoredCount === 0 && <Notice tone="warning">No records were scored in this run. {job.status === 'cancelled' ? 'The run was stopped before any results were ready.' : ''}</Notice>}
      {!running && rows && fin && scoredCount > 0 && (
        <>
          <Buckets job={job} rows={rows} fin={fin} onPick={(band) => jumpToList({ band, dept: '', cls: '' })} />
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <Drivers rows={rows} enableAge={!!job.settings?.enableAge} />
            <ByGroup rows={rows} onPickGroup={(by, key) => jumpToList(by === 'department' ? { dept: key, cls: '', band: '' } : { cls: key, dept: '', band: '' })} />
          </div>
          <Journey job={job} rows={rows} />
          <div ref={tabsRef} className="flex gap-1 mb-4 border-b border-slate-200 scroll-mt-4">
            {[['results', job.type === 'prehire' ? 'Candidate list' : 'Employee list'], ['financial', 'Financial impact'], ['method', 'How scores work']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === k ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>
          {tab === 'results' && <ResultsTable rows={rows} job={job} filters={filters} setFilters={setFilters} />}
          {tab === 'financial' && <Financial rows={rows} cfg={cfg} setCfg={setCfg} />}
          {tab === 'method' && <Method job={job} model={model} />}
        </>
      )}
    </div>
  );
}

