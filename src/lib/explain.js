// Plain-language helpers for the results screens: what each factor means, why a
// person landed in their outlook, and how the numbers for a run were built.
// Everything here is derived from the scored rows; nothing is estimated.

export const BAND_ORDER = ['At risk', 'Watch', 'Likely to stay'];
export const BAND_COLOR = { 'At risk': '#dc2626', Watch: '#f59e0b', 'Likely to stay': '#059669' };
export const BAND_RANGE = { 'At risk': 'Score below 0', Watch: 'Score 0 to 19', 'Likely to stay': 'Score 20 or more' };
export const BAND_MEANING = {
  current: {
    'At risk': 'Most likely to leave. Reach out this month.',
    Watch: 'Could go either way. Check in this quarter.',
    'Likely to stay': 'Stable today. Keep doing what works.',
  },
  prehire: {
    'At risk': 'Weak fit for staying long term. Probe in the interview.',
    Watch: 'Mixed fit. Confirm the concerns before an offer.',
    'Likely to stay': 'Strong fit for staying long term.',
  },
};

export const DOMAIN_KEYS = ['financial', 'schedule', 'workLife', 'communication'];

export const FACTORS = [
  { key: 'distance', label: 'Commute distance', short: 'Commute' },
  { key: 'tenure', label: 'Time on the job', short: 'Tenure' },
  { key: 'turnover', label: 'Turnover in their role', short: 'Role turnover' },
  { key: 'financial', label: 'Financial stress', short: 'Financial', domain: true },
  { key: 'schedule', label: 'Schedule stress', short: 'Schedule', domain: true },
  { key: 'workLife', label: 'Work-life balance', short: 'Work-life', domain: true },
  { key: 'communication', label: 'Communication', short: 'Communication', domain: true },
  { key: 'age', label: 'Age', short: 'Age', optional: true },
];

export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export function stressLabel(v) {
  if (v == null) return 'No signal';
  if (v <= 3) return 'Low';
  if (v <= 6) return 'Moderate';
  return 'High';
}

export function firstName(name) {
  if (!name) return '';
  if (name.includes(',')) {
    const after = name.split(',')[1].trim().split(/\s+/);
    // "Last, Jr. First" style: skip a suffix token.
    const tok = after.find((t) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(t));
    return tok || '';
  }
  return name.trim().split(/\s+/)[0];
}

export function displayName(name) {
  if (!name || !name.includes(',')) return name || '';
  const [last, rest] = name.split(',');
  return `${rest.trim()} ${last.trim()}`;
}

const years = (m) => {
  if (m == null) return '';
  const y = Math.floor(m / 12); const mo = Math.round(m % 12);
  if (!y) return `${mo} mo`;
  return mo ? `${y} yr ${mo} mo` : `${y} yr`;
};

/** One line describing the data behind a factor for one person. */
export function factorDetail(r, key, jobType) {
  const f = r.factors || {};
  switch (key) {
    case 'distance':
      return f.distanceMiles != null ? `${f.distanceMiles} miles from the job site` : `Not known (${f.distanceSource || 'no address'}), scored neutral`;
    case 'tenure':
      if (f.tenureMonths == null) return 'Not known, scored neutral';
      return `${years(f.tenureMonths)} ${jobType === 'prehire' ? 'at current employer' : 'since hire date'}`;
    case 'turnover':
      return f.turnoverPct != null ? `${f.turnoverPct}% of this job class left in the last 12 months` : 'Not known for this job class, scored neutral';
    case 'age':
      return f.ageYears != null ? `${f.ageYears} years` : 'Not used';
    default: {
      const v = r.domains?.[key];
      if (v == null) return r.postsConsidered ? 'Nothing found in recent posts, scored neutral' : 'No recent public posts, scored neutral';
      return `Stress level ${v} of 10 (${stressLabel(v).toLowerCase()})`;
    }
  }
}

export function factorsFor(r, jobType, enableAge) {
  return FACTORS.filter((x) => !x.optional || enableAge).map((x) => ({
    ...x,
    points: r.breakdown?.[x.key] ?? 0,
    detail: factorDetail(r, x.key, jobType),
  }));
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** Short story for the expanded row: where the score lands and why. */
export function whySummary(r, jobType, enableAge) {
  const items = factorsFor(r, jobType, enableAge);
  const neg = items.filter((i) => i.points < 0).sort((a, b) => a.points - b.points).slice(0, 3);
  const pos = items.filter((i) => i.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
  const who = firstName(r.name) || (jobType === 'prehire' ? 'This candidate' : 'This employee');
  const lead = `${who} scored ${signed(r.retentionScore)} points, which is ${r.band}.`;
  const down = neg.length ? `Pulling the score down: ${joinList(neg.map((i) => `${lower(i.label)} (${signed(i.points)})`))}.` : 'Nothing is pulling the score down.';
  const up = pos.length ? `Holding it up: ${joinList(pos.map((i) => `${lower(i.label)} (${signed(i.points)})`))}.` : 'Nothing is holding it up.';
  return { lead, down, up, neg, pos };
}

const ACTIONS = {
  current: {
    distance: 'Ask about the commute. Flexible start times or a closer site can help.',
    tenure: 'Their time on the job sits in a window where people often leave. A stay interview can help.',
    turnover: 'People in this role leave often. Review pay, workload and staffing for the role.',
    financial: 'Money stress is showing. Review pay band, shift differentials and benefits.',
    schedule: 'Schedule stress is showing. Talk about shift preferences and overtime.',
    workLife: 'Work-life strain is showing. Check workload and time off.',
    communication: 'Communication friction is showing. A one-on-one with their manager can help.',
    age: 'Review career stage needs in a one-on-one.',
  },
  prehire: {
    distance: 'Confirm the commute works for them before an offer.',
    tenure: 'Ask about their job history and what makes them stay.',
    turnover: 'This role turns over often. Be clear about workload and schedule up front.',
    financial: 'Discuss pay expectations early.',
    schedule: 'Confirm shift and schedule fit.',
    workLife: 'Talk through workload and time off expectations.',
    communication: 'Ask how they prefer to work with a manager.',
    age: '',
  },
};

export function nextStep(r, jobType, enableAge) {
  const { neg, pos } = whySummary(r, jobType, enableAge);
  const map = ACTIONS[jobType === 'prehire' ? 'prehire' : 'current'];
  if (r.band === 'Likely to stay') {
    return pos.length ? [`Strongest point: ${lower(pos[0].label)}. Keep it that way.`] : ['No action needed today.'];
  }
  // A short commute that scores low is a pattern, not something to act on.
  const actionable = neg.filter((i) => !(i.key === 'distance' && (r.factors?.distanceMiles ?? 99) <= 15));
  const steps = actionable.slice(0, 2).map((i) => map[i.key]).filter(Boolean);
  return steps.length ? steps : ['No single factor stands out. A general check-in is the best next step.'];
}

/** Average points per factor for a group of scored rows. */
export function driverStats(rows, enableAge) {
  const list = FACTORS.filter((x) => !x.optional || enableAge);
  if (!rows.length) return list.map((x) => ({ ...x, avg: 0, negCount: 0 }));
  return list.map((x) => {
    const vals = rows.map((r) => r.breakdown?.[x.key] ?? 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { ...x, avg: Math.round(avg * 10) / 10, negCount: vals.filter((v) => v < 0).length };
  });
}

/** The factor that hurts (or helps, for Likely to stay) a bucket most. */
export function mainReason(rows, band, enableAge) {
  const stats = driverStats(rows, enableAge);
  if (!rows.length) return null;
  if (band === 'Likely to stay') {
    const best = [...stats].sort((a, b) => b.avg - a.avg)[0];
    return best && best.avg > 0 ? { text: `Strongest: ${lower(best.label)}`, avg: best.avg } : null;
  }
  const worst = [...stats].sort((a, b) => a.avg - b.avg)[0];
  return worst && worst.avg < 0 ? { text: `Top reason: ${lower(worst.label)}`, avg: worst.avg } : null;
}

export function groupBy(rows, keyFn) {
  const g = {};
  rows.forEach((r) => {
    const k = keyFn(r) || 'Unspecified';
    g[k] = g[k] || { key: k, total: 0, 'At risk': 0, Watch: 0, 'Likely to stay': 0 };
    g[k].total++; g[k][r.band]++;
  });
  return Object.values(g).sort((a, b) => b['At risk'] / b.total - a['At risk'] / a.total || b.Watch / b.total - a.Watch / a.total || b.total - a.total);
}

/** Step-by-step counts for "How we got these numbers". */
export function journey(job, rows) {
  const done = rows.filter((r) => r.status === 'done');
  const skipped = rows.filter((r) => r.status === 'skipped');
  const errors = rows.filter((r) => r.status === 'error');
  const reasons = {};
  skipped.forEach((r) => { const k = r.skipReason || 'Skipped'; reasons[k] = (reasons[k] || 0) + 1; });
  const matched = done.filter((r) => Object.values(r.profiles || {}).some(Boolean));
  const networks = { LinkedIn: 0, Facebook: 0, X: 0 };
  matched.forEach((r) => { if (r.profiles.linkedin) networks.LinkedIn++; if (r.profiles.facebook) networks.Facebook++; if (r.profiles.twitter) networks.X++; });
  const withPosts = done.filter((r) => r.postsConsidered > 0);
  const totalPosts = done.reduce((a, r) => a + (r.postsConsidered || 0), 0);
  const withSignal = done.filter((r) => ['social', 'demo'].includes(r.socialSource));
  const provided = done.filter((r) => r.socialSource === 'provided');
  const phrases = done.reduce((a, r) => a + (r.evidence || []).reduce((s, e) => s + (e.count || 0), 0), 0);
  const coverage = {
    distance: done.filter((r) => r.factors?.distanceMiles != null).length,
    tenure: done.filter((r) => r.factors?.tenureMonths != null).length,
    turnover: done.filter((r) => r.factors?.turnoverPct != null).length,
    signal: withSignal.length + provided.length,
  };
  return {
    fileRows: job.counts?.rows ?? rows.length,
    scored: done.length, errors: errors.length, skipped: skipped.length, reasons,
    matched: matched.length, networks,
    withPosts: withPosts.length, totalPosts,
    withSignal: withSignal.length, provided: provided.length, phrases,
    coverage,
  };
}
