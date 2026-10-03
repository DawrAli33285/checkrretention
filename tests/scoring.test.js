const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreRetention, woePoints, turnoverPoints, socialPoints, DEFAULT_BANDS, AGE_THRESHOLDS, DIST_TENURE_THRESHOLDS } = require('../server/scoring/model');
const { scorePosts, decayedWeight } = require('../server/scoring/signals');

test('spreadsheet bands are complete and sum to 100%', () => {
  for (const [k, bands] of Object.entries(DEFAULT_BANDS)) {
    const sum = bands.reduce((a, b) => a + b.share, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${k} shares sum to ${sum}`);
  }
  assert.equal(DEFAULT_BANDS.tenure.length, 41); // 40 three-month bands + 121+
});

test('age WOE matches the spreadsheet method (fraction units)', () => {
  // 40-44 holds 34% of ideal staff -> centered 0.381 -> +7
  assert.equal(woePoints(41, DEFAULT_BANDS.age, AGE_THRESHOLDS).points, 7);
  // 20-24 holds 0% -> centered -0.138 -> -3
  assert.equal(woePoints(22, DEFAULT_BANDS.age, AGE_THRESHOLDS).points, -3);
});

test('distance and tenure WOE', () => {
  assert.equal(woePoints(18, DEFAULT_BANDS.distance, DIST_TENURE_THRESHOLDS).points, 7); // 16-20 band, 28%
  assert.equal(woePoints(45, DEFAULT_BANDS.distance, DIST_TENURE_THRESHOLDS).points, -5); // 41-45 band (spreadsheet sample)
  assert.equal(woePoints(2, DEFAULT_BANDS.tenure, DIST_TENURE_THRESHOLDS).points, 5); // 0-3 months, 12%
  // Spreadsheet defect fixed: tenure beyond 36 months is scored on its own band, not clamped to 34-36.
  assert.equal(woePoints(80, DEFAULT_BANDS.tenure, DIST_TENURE_THRESHOLDS).band, '79-81 mo');
});

test('turnover and social tables', () => {
  assert.equal(turnoverPoints(5), 12);
  assert.equal(turnoverPoints(22), 3);
  assert.equal(turnoverPoints(75), -20);
  assert.equal(turnoverPoints(null), null);
  assert.equal(socialPoints(1), 7);
  assert.equal(socialPoints(6), 0);
  assert.equal(socialPoints(10), -7);
  assert.equal(socialPoints(null), 0);
});

test('missing inputs are neutral, never random', () => {
  const a = scoreRetention({});
  const b = scoreRetention({});
  assert.deepEqual(a, b);
  assert.equal(a.retentionScore, 0);
  assert.equal(a.band, 'Watch');
  assert.equal(a.coverage.social, false);
});

test('age is excluded unless enabled', () => {
  const off = scoreRetention({ ageYears: 41 });
  const on = scoreRetention({ ageYears: 41 }, { enableAge: true });
  assert.equal(off.breakdown.age, 0);
  assert.equal(on.breakdown.age, 7);
});

test('full example sums correctly', () => {
  const r = scoreRetention({ distanceMiles: 18, tenureMonths: 2, turnoverPct: 12, domains: { financial: 1, schedule: 3, workLife: 8, communication: null } });
  // distance 7 + tenure 5 + turnover 9 + fin 7 + sched 3 + wlb -3 + comm 0
  assert.equal(r.retentionScore, 28);
  assert.equal(r.band, 'Likely to stay');
  assert.equal(r.rightFit, true);
});

test('social listening: phrases, decay, protective terms, windows', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  assert.equal(decayedWeight(1), 1);
  assert.equal(decayedWeight(4), 1.85);
  const none = scorePosts([], { now });
  assert.equal(none.domains.financial, null);
  const posts = [
    { text: 'I am so UNDERPAID it hurts', date: '2026-08-20' },
    { text: 'underpaid again this month', date: '2026-08-25' },
    { text: 'Great day at the lake', date: '2026-08-26' },
    { text: 'underpaid back in the spring', date: '2026-03-01' }, // outside 60 days
    { text: 'We are underpaid', companyReshare: true, date: '2026-08-26' }, // ignored
  ];
  const r = scorePosts(posts, { now });
  assert.equal(r.postsConsidered, 3);
  const ev = r.evidence.find((e) => e.phrase === 'underpaid');
  assert.equal(ev.count, 2);
  // underpaid: severity 3 x (1 + 0.5) = 4.5 -> raw 1 + round(4.5) = 6
  assert.equal(r.domains.financial, 6);
  // three posts with no schedule phrases -> pressure 1 (no pressure found)
  assert.equal(r.domains.schedule, 1);
  const protective = scorePosts([...posts, { text: 'honestly we are paid well here', date: '2026-08-27' }], { now });
  assert.equal(protective.domains.financial, 5);
});

test('too few posts without a hit is not evidence of low pressure', () => {
  const r = scorePosts([{ text: 'hello world', date: new Date() }]);
  assert.equal(r.domains.schedule, null);
});

test('point tables for the explanation screen come from the model', () => {
  const { pointTables } = require('../server/lib/results');
  const t = pointTables();
  assert.equal(t.turnover[0].points, 12);
  assert.equal(t.turnover[t.turnover.length - 1].points, -20);
  assert.equal(t.social.find((r) => r.label === '1').points, 7);
  assert.ok(t.distance.every((r) => r.label.endsWith('mi')));
  assert.ok(t.tenure.length > 5 && t.tenure.length < 41, 'adjacent equal bands are merged');
});
