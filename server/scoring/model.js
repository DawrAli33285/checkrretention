// Retention scoring model.
//
// Source of truth: "Retention Calculation.xlsx" (Staff Retention folder).
//   Likelihood of Retention = Age + Distance + Tenure + Turnover
//                           + Finance + Schedule + Work-Life Balance + Family/Communication
//
// Age, Distance and Tenure use the spreadsheet's WOE-style method:
//   1. find the band the person falls in
//   2. log ratio  = ln((bandShare + eps) / (meanShare + eps))
//   3. centered   = logRatio - mean(logRatio across bands)
//   4. points     = lookup(centered) in the sheet's threshold table
// bandShare is "Percent of Ideal Staff in Band for the Job Class". The defaults
// below are the spreadsheet's example distribution; per-client distributions
// can be passed in through `overrides`.
//
// Two defects in the spreadsheet are corrected here and called out in the README:
//   * Tenure MATCH/INDEX only covered the first 12 bands (0-36 months), so any
//     tenure above 3 years was scored as the 34-36 month band.
//   * The "Feed to Retention Score" cells were hardcoded (=J12, =J18, =J14)
//     instead of looking up the centered score.

const MODEL_VERSION = '2.0.0';
const EPSILON = 0.5;

// Threshold tables: [minCenteredScore, points], evaluated top-down.
const AGE_THRESHOLDS = [
  [0.5, 15], [0.4, 10], [0.25, 7], [0.15, 5], [0.05, 3], [0, 1],
  [-0.05, -1], [-0.15, -3], [-0.25, -5], [-0.4, -7], [-0.5, -10], [-Infinity, -15],
];
const DIST_TENURE_THRESHOLDS = [
  [0.5, 15], [0.4, 10], [0.25, 7], [0.15, 5], [0.05, 3], [0, 1],
  [-0.04, -1], [-0.09, -3], [-0.12, -5], [-0.16, -7], [-0.2, -10], [-Infinity, -15],
];

const DEFAULT_BANDS = {
  age: [
    { label: 'Under 19', min: 15, max: 19, share: 0.02 },
    { label: '20-24', min: 20, max: 24, share: 0 },
    { label: '25-29', min: 25, max: 29, share: 0.03 },
    { label: '30-34', min: 30, max: 34, share: 0.11 },
    { label: '35-39', min: 35, max: 39, share: 0.29 },
    { label: '40-44', min: 40, max: 44, share: 0.34 },
    { label: '45-49', min: 45, max: 49, share: 0.14 },
    { label: '50-54', min: 50, max: 54, share: 0.03 },
    { label: '55-59', min: 55, max: 59, share: 0 },
    { label: '60-64', min: 60, max: 64, share: 0.03 },
    { label: '65-69', min: 65, max: 69, share: 0.01 },
    { label: '70+', min: 70, max: 200, share: 0 },
  ],
  distance: [
    { label: 'Under 5', min: 0, max: 5, share: 0.02 },
    { label: '6-10', min: 5.0001, max: 10, share: 0.06 },
    { label: '11-15', min: 10.0001, max: 15, share: 0.05 },
    { label: '16-20', min: 15.0001, max: 20, share: 0.28 },
    { label: '21-25', min: 20.0001, max: 25, share: 0.26 },
    { label: '26-30', min: 25.0001, max: 30, share: 0.15 },
    { label: '31-35', min: 30.0001, max: 35, share: 0.09 },
    { label: '36-40', min: 35.0001, max: 40, share: 0.05 },
    { label: '41-45', min: 40.0001, max: 45, share: 0.02 },
    { label: '46-50', min: 45.0001, max: 50, share: 0.01 },
    { label: '51-75', min: 50.0001, max: 75, share: 0 },
    { label: '76-100', min: 75.0001, max: 100, share: 0.01 },
    { label: '101+', min: 100.0001, max: 100000, share: 0 },
  ],
  // 3-month bands 0-120, then 121+
  tenure: (() => {
    const shares = [0.12, 0.06, 0.05, 0.03, 0.04, 0.02, 0.09, 0.1, 0.07, 0.03, 0.04, 0.05, 0.03, 0.09,
      0.02, 0.01, 0.02, 0.01, 0.01, 0, 0.01, 0, 0.01, 0, 0, 0.01, 0.01, 0.02, 0, 0, 0, 0.01, 0.02, 0.01,
      0, 0, 0, 0, 0, 0];
    const bands = shares.map((share, i) => {
      const min = i === 0 ? 0 : i * 3 + 1;
      const max = (i + 1) * 3;
      return { label: `${min}-${max} mo`, min, max: max + 0.9999, share };
    });
    bands.push({ label: '121+ mo', min: 121, max: 100000, share: 0.01 });
    return bands;
  })(),
};

// Department / job-class turnover % (annual) -> points. "Department Turnover" tab.
const TURNOVER_BANDS = [
  [0, 10, 12], [10, 15, 9], [15, 20, 6], [20, 25, 3], [25, 30, -3], [30, 35, -5],
  [35, 40, -7], [40, 45, -9], [45, 50, -11], [50, 55, -13], [55, 60, -15], [60, Infinity, -20],
];

// Social listening raw 1-10 -> points ("Social Listening" tab, same for all four domains).
// Raw 1 = no pressure found, raw 10 = heavy pressure.
const SOCIAL_POINTS = { 1: 7, 2: 5, 3: 3, 4: 2, 5: 1, 6: 0, 7: -1, 8: -3, 9: -5, 10: -7 };

// The four domains that feed the retention score. The spreadsheet calls the
// fourth one "Family"; the keyword library and client reports call it
// "Communication". It is one slot, labelled Communication in the UI.
const DOMAINS = [
  { key: 'financial', label: 'Financial' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'workLife', label: 'Work-Life Balance' },
  { key: 'communication', label: 'Communication' },
];
// Scored for insight only, not part of the retention sum (spreadsheet has 4 domains).
const INSIGHT_DOMAINS = [{ key: 'jobSatisfaction', label: 'Job Satisfaction' }];

// Retention score bands shown to clients. Points are NOT a percentage and must
// not be displayed as one until the model is calibrated against real exits.
const RETENTION_BANDS = { likelyToStayMin: 20, watchMin: 0 };

function woePoints(value, bands, thresholds) {
  if (value === null || value === undefined || Number.isNaN(value)) return { points: 0, band: null, centered: null };
  const n = bands.length;
  const meanShare = 100 / n; // spreadsheet: =100/ROWS(...)
  const logRatios = bands.map((b) => Math.log((b.share + EPSILON) / (meanShare + EPSILON)));
  const meanLog = logRatios.reduce((a, b) => a + b, 0) / n;
  let idx = bands.findIndex((b) => value >= b.min && value <= b.max);
  if (idx === -1) idx = value < bands[0].min ? 0 : n - 1;
  const centered = logRatios[idx] - meanLog;
  const points = thresholds.find(([min]) => centered >= min)[1];
  return { points, band: bands[idx].label, centered: Math.round(centered * 1000) / 1000 };
}

function turnoverPoints(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return null;
  const row = TURNOVER_BANDS.find(([lo, hi]) => pct >= lo && pct < hi);
  return row ? row[2] : TURNOVER_BANDS[TURNOVER_BANDS.length - 1][2];
}

function socialPoints(raw) {
  if (raw === null || raw === undefined) return 0; // no signal = neutral, never invented
  const r = Math.min(10, Math.max(1, Math.round(raw)));
  return SOCIAL_POINTS[r];
}

function retentionBand(score) {
  if (score >= RETENTION_BANDS.likelyToStayMin) return 'Likely to stay';
  if (score >= RETENTION_BANDS.watchMin) return 'Watch';
  return 'At risk';
}

/**
 * Score one person.
 * @param {object} input { ageYears, distanceMiles, tenureMonths, turnoverPct, domains:{financial,...} (raw 1-10 or null) }
 * @param {object} opts  { enableAge, bands }  bands overrides DEFAULT_BANDS per factor
 */
function scoreRetention(input, opts = {}) {
  const bands = { ...DEFAULT_BANDS, ...(opts.bands || {}) };
  const age = opts.enableAge ? woePoints(input.ageYears, bands.age, AGE_THRESHOLDS) : { points: 0, band: null, centered: null, disabled: true };
  const distance = woePoints(input.distanceMiles, bands.distance, DIST_TENURE_THRESHOLDS);
  const tenure = woePoints(input.tenureMonths, bands.tenure, DIST_TENURE_THRESHOLDS);
  const turnover = turnoverPoints(input.turnoverPct);

  const domains = input.domains || {};
  const domainPoints = {};
  for (const d of DOMAINS) domainPoints[d.key] = socialPoints(domains[d.key]);

  const breakdown = {
    age: age.points,
    distance: distance.points,
    tenure: tenure.points,
    turnover: turnover ?? 0,
    ...domainPoints,
  };
  const retentionScore = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Which factors had real data behind them. Missing inputs score 0 (neutral).
  const coverage = {
    age: opts.enableAge ? input.ageYears != null : 'disabled',
    distance: input.distanceMiles != null,
    tenure: input.tenureMonths != null,
    turnover: turnover !== null,
    social: DOMAINS.some((d) => domains[d.key] != null),
  };

  return {
    modelVersion: MODEL_VERSION,
    retentionScore,
    band: retentionBand(retentionScore),
    rightFit: retentionScore >= RETENTION_BANDS.likelyToStayMin,
    breakdown,
    bandsHit: { age: age.band, distance: distance.band, tenure: tenure.band },
    coverage,
  };
}

module.exports = {
  MODEL_VERSION,
  DEFAULT_BANDS,
  TURNOVER_BANDS,
  SOCIAL_POINTS,
  DOMAINS,
  INSIGHT_DOMAINS,
  RETENTION_BANDS,
  AGE_THRESHOLDS,
  DIST_TENURE_THRESHOLDS,
  woePoints,
  turnoverPoints,
  socialPoints,
  retentionBand,
  scoreRetention,
};
