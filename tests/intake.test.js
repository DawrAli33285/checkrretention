const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFile, buildIntake, computeTurnover } = require('../server/lib/intake');
const { parseDate, normalizePhone, normalizeZip, normalizeJobClass, splitName } = require('../server/lib/normalize');

test('date parsing handles the formats found in client files', () => {
  assert.equal(parseDate('5/1/23 0:00').toISOString().slice(0, 10), '2023-05-01');
  assert.equal(parseDate('12/28/70 0:00').toISOString().slice(0, 10), '1970-12-28');
  assert.equal(parseDate('03/20/2020').toISOString().slice(0, 10), '2020-03-20');
  assert.equal(parseDate('2024-02-26').toISOString().slice(0, 10), '2024-02-26');
  assert.equal(parseDate('45000').toISOString().slice(0, 10), '2023-03-15');
  assert.equal(parseDate('N/A'), null);
  assert.equal(parseDate('13/45/2020'), null);
  assert.equal(parseDate('2020-13-45'), null);
  assert.equal(parseDate('2/30/2021'), null);
});

test('phones, zips, job classes, names', () => {
  for (const p of ['+1 317-995-0375', '+1 317 995 0375', '3179950375', '+13179950375', '(317) 995-0375']) assert.equal(normalizePhone(p), '+13179950375');
  assert.equal(normalizePhone('555-0142'), '');
  assert.equal(normalizeZip('46140.0'), '46140');
  assert.equal(normalizeZip(6040), '06040');
  assert.equal(normalizeJobClass('Staff Nurse RN - R6025'), 'Staff Nurse RN');
  assert.deepEqual(splitName('parkyn, matthew'), { first: 'Matthew', last: 'Parkyn', display: 'parkyn, matthew' });
});

test('current staff sample: duplicates merged, leavers used for turnover only', async () => {
  const f = path.join(__dirname, '..', 'samples', 'current_staff_sample.csv');
  const { headers, rows } = await parseFile(fs.readFileSync(f), 'current_staff_sample.csv');
  const it = buildIntake('current', headers, rows);
  assert.equal(it.stats.rows, 49);
  assert.equal(it.stats.terminated, 8);
  assert.equal(it.stats.duplicate, 1);
  assert.equal(it.stats.noContact, 1);
  assert.equal(it.stats.billable, 39);
  assert.ok(it.turnover.length > 0);
});

test('pre-hire sample: second requisition for the same person is not charged', async () => {
  const f = path.join(__dirname, '..', 'samples', 'prehire_sample.csv');
  const { headers, rows } = await parseFile(fs.readFileSync(f), 'prehire_sample.csv');
  const it = buildIntake('prehire', headers, rows);
  assert.equal(it.stats.billable, 25);
  assert.equal(it.stats.duplicate, 1);
  // Opportunity Title is used when Source Job is blank
  assert.ok(it.records.every((r) => r.rec.jobClass));
});

test('missing required columns are reported by name', () => {
  assert.throws(() => buildIntake('prehire', ['Name', 'Phone'], [{ Name: 'A', Phone: '3175550100' }]), /Email Address/);
});

test('turnover excludes temp-contract ends and transfers', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const recs = [];
  for (let i = 0; i < 10; i++) recs.push({ jobClass: 'RN', terminated: false });
  recs.push({ jobClass: 'RN', terminated: true, termDate: new Date('2026-06-01'), termReason: 'Resigned' });
  recs.push({ jobClass: 'RN', terminated: true, termDate: new Date('2026-06-01'), termReason: 'End Of Temp Employment' });
  recs.push({ jobClass: 'RN', terminated: true, termDate: new Date('2024-01-01'), termReason: 'Resigned' }); // older than 12 months
  const t = computeTurnover(recs, now);
  assert.equal(t[0].separations, 1);
  assert.equal(t[0].pct, 9.5); // 1 / (10 + 0.5)
});
