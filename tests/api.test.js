// End-to-end API test. Needs a MongoDB (or FerretDB) at TEST_MONGODB_URI; skipped otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const uri = process.env.TEST_MONGODB_URI;
const skip = !uri && 'set TEST_MONGODB_URI to run the API test';

Object.assign(process.env, {
  MONGODB_URI: uri || '', JWT_SECRET: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  PROVIDER_MODE: 'demo', GEOCODER: 'none', PRICE_PER_RECORD_CURRENT: '2.95', PRICE_PER_RECORD_PREHIRE: '0', STEP_BUDGET_MS: '20000',
});

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../server/app');
const { disconnectDb } = require('../server/db');

const sample = (f) => path.join(__dirname, '..', 'samples', f);

// Browser-like client: keeps the session cookie and sends the app header on writes.
function client(app) {
  const agent = request.agent(app);
  const w = (m) => (url) => agent[m](url).set('X-Requested-With', 'prognosticare');
  return { get: (url) => agent.get(url), post: w('post'), patch: w('patch'), del: w('delete'), raw: agent };
}

test('full client + admin flow', { skip, timeout: 120000 }, async (t) => {
  const app = createApp();
  await request(app).get('/api/health').expect(200);
  const { connectDb } = require('../server/db');
  await connectDb();
  await mongoose.connection.dropDatabase();
  await require('../server/db').ensureIndexes();

  const admin = client(app);
  const anon = client(app);

  await t.test('first-run setup creates the admin once, with no env secrets', async () => {
    const cfg = (await anon.get('/api/config').expect(200)).body;
    assert.equal(cfg.needsSetup, true);
    await anon.post('/api/auth/setup').send({ email: 'bad', password: 'short' }).expect(400);
    const r = await admin.post('/api/auth/setup').send({ email: 'admin@example.com', password: 'admin-password-123', name: 'Ops' }).expect(201);
    assert.equal(r.body.user.role, 'admin');
    assert.ok(!('passwordHash' in r.body.user));
    await anon.post('/api/auth/setup').send({ email: 'evil@example.com', password: 'evil-password-123' }).expect(409);
    assert.equal((await anon.get('/api/config').expect(200)).body.needsSetup, false);
    // session cookie is httpOnly
    const login = await anon.post('/api/auth/login').send({ email: 'admin@example.com', password: 'admin-password-123' }).expect(200);
    assert.match(String(login.headers['set-cookie']), /HttpOnly/i);
    assert.ok(!login.body.token, 'token is never exposed to page scripts');
    await anon.post('/api/auth/logout').expect(200);
    await anon.get('/api/auth/me').expect(401);
  });

  await t.test('security basics', async () => {
    await anon.get('/api/jobs').expect(401);
    assert.equal((await anon.get('/api/auth/session').expect(200)).body.user, null);
    assert.equal((await admin.get('/api/auth/session').expect(200)).body.user.email, 'admin@example.com');
    await request(app).get('/api/admin/users').set('Cookie', 'pc_session=nonsense').expect(401);
    await anon.post('/api/auth/login').send({ email: 'admin@example.com', password: 'wrong' }).expect(401);
    await anon.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong' }).expect(401);
    await anon.post('/api/auth/register').send({ email: 'x@example.com', password: '1234567890', credits: 999999, role: 'admin' }).expect(403);
    // writes without the app header are refused (cross-site request protection)
    await admin.raw.post('/api/admin/users').send({ email: 'z@example.com', password: 'zzzzzzzzzz' }).expect(403);
  });

  const created = (await admin.post('/api/admin/users').send({ email: 'client@example.com', password: 'client-password-1', organization: 'Example Health', credits: 200 }).expect(201)).body.user;
  await admin.post('/api/admin/users').send({ email: 'other@example.com', password: 'other-password-1' }).expect(201);
  const C = client(app); const O = client(app);
  await C.post('/api/auth/login').send({ email: 'client@example.com', password: 'client-password-1' }).expect(200);
  await O.post('/api/auth/login').send({ email: 'other@example.com', password: 'other-password-1' }).expect(200);
  await C.get('/api/admin/users').expect(403);

  const runToEnd = async (who, job) => {
    let status = job.status; let guard = 0; let sawRecent = false;
    while (!['completed', 'failed', 'cancelled'].includes(status) && guard++ < 20) {
      const r = (await who.post(`/api/jobs/${job._id}/step`).expect(200)).body;
      status = r.job.status; if (r.recent?.length) sawRecent = true;
    }
    return { status, sawRecent };
  };

  let jobId;
  await t.test('current staff: preview, charge, process, export', async () => {
    const pv = (await C.post('/api/jobs/preview').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(200)).body;
    assert.equal(pv.stats.billable, 39);
    assert.equal(pv.cost, 115.05);
    assert.equal(pv.providerMode, 'demo');
    const job = (await C.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(201)).body.job;
    jobId = job._id;
    assert.equal((await C.get('/api/auth/me').expect(200)).body.user.credits, 84.95);
    const { status, sawRecent } = await runToEnd(C, job);
    assert.equal(status, 'completed');
    assert.ok(sawRecent, 'steps report recently scored people');
    const res = (await C.get(`/api/jobs/${jobId}/results`).expect(200)).body;
    const done = res.rows.filter((r) => r.status === 'done');
    assert.equal(done.length, 39);
    assert.ok(done.every((r) => Number.isFinite(r.retentionScore)));
    assert.ok(done.every((r) => r.flags.some((f) => f.startsWith('Demo data'))));
    assert.ok(done.some((r) => r.factors.turnoverPct != null), 'turnover from leavers is applied');
    assert.ok(done.every((r) => r.factors.distanceMiles != null), 'distance from file column');
    const xlsx = await C.get(`/api/jobs/${jobId}/export`).buffer(true).parse((r, cb) => { const b = []; r.on('data', (c) => b.push(c)); r.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    assert.ok(xlsx.body.length > 5000);
    const csv = await C.get(`/api/jobs/${jobId}/export?format=csv`).expect(200);
    assert.match(csv.text, /DEMO RUN/);
  });

  await t.test('another client cannot see the job', async () => {
    await O.get(`/api/jobs/${jobId}/results`).expect(404);
    await O.post(`/api/jobs/${jobId}/step`).expect(404);
  });

  await t.test('monthly limit: second current-staff run is blocked, admin can grant one', async () => {
    const r = await C.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(429);
    assert.match(r.body.error, /exceeded your processing limit for this month/);
    await admin.patch(`/api/admin/users/${created._id}`).send({ grantExtraRun: true }).expect(200);
    const again = await C.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(400);
    assert.match(again.body.error, /No scorable records/);
  });

  await t.test('pre-hire runs use the saved turnover table and are free by default', async () => {
    const job = (await C.post('/api/jobs').field('type', 'prehire').attach('file', sample('prehire_sample.csv')).expect(201)).body.job;
    assert.equal(job.cost, 0);
    await runToEnd(C, job);
    const rows = (await C.get(`/api/jobs/${job._id}/results`).expect(200)).body.rows.filter((r) => r.status === 'done');
    assert.equal(rows.length, 25);
    assert.ok(rows.every((r) => r.breakdown.age === 0));
  });

  await t.test('cancel refunds unscored records', async () => {
    await admin.post(`/api/admin/users/${created._id}/credits`).send({ amount: 200 }).expect(200);
    await admin.patch(`/api/admin/users/${created._id}`).send({ grantExtraRun: true }).expect(200);
    const Record = require('../server/models/Record');
    await Record.deleteMany({ jobType: 'current' });
    const before = (await C.get('/api/auth/me')).body.user.credits;
    const job = (await C.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(201)).body.job;
    const r = (await C.post(`/api/jobs/${job._id}/cancel`).expect(200)).body;
    assert.equal(r.refund, 115.05);
    assert.equal((await C.get('/api/auth/me')).body.user.credits, before);
  });

  await t.test('invoices add credits only when marked paid', async () => {
    const start = (await C.get('/api/auth/me')).body.user.credits;
    const inv = (await admin.post('/api/admin/invoices').send({ userId: created._id, amount: 50, description: 'Top-up', email: false }).expect(201)).body.invoice;
    assert.equal((await C.get('/api/auth/me')).body.user.credits, start);
    await admin.post(`/api/admin/invoices/${inv._id}/paid`).expect(200);
    await admin.post(`/api/admin/invoices/${inv._id}/paid`).expect(400);
    assert.equal((await C.get('/api/auth/me')).body.user.credits, start + 50);
  });

  await t.test('insufficient credits are refused before any work', async () => {
    const bal = (await C.get('/api/auth/me')).body.user.credits;
    await admin.post(`/api/admin/users/${created._id}/credits`).send({ amount: -bal }).expect(200);
    await admin.patch(`/api/admin/users/${created._id}`).send({ grantExtraRun: true }).expect(200);
    const Record = require('../server/models/Record');
    await Record.deleteMany({ jobType: 'current' });
    const r = await C.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(402);
    assert.match(r.body.error, /costs \$115\.05/);
  });

  await t.test('review fixes: parallel cancels refund once, limits hold, sessions end on password change', async () => {
    const Record = require('../server/models/Record');
    const u = (await admin.post('/api/admin/users').send({ email: 'race@example.com', password: 'race-password-1', credits: 1000 }).expect(201)).body.user;
    const R = client(app);
    await R.post('/api/auth/login').send({ email: 'race@example.com', password: 'race-password-1' }).expect(200);
    // three uploads at once: only one current-staff run per month gets through
    const results = await Promise.all([1, 2, 3].map(() => R.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv'))));
    const created = results.filter((r) => r.status === 201);
    assert.equal(created.length, 1, `statuses ${results.map((r) => r.status)}`);
    assert.equal((await R.get('/api/auth/me')).body.user.credits, 884.95);
    // three cancels at once: refunded exactly once
    const job = created[0].body.job;
    const cancels = await Promise.all([1, 2, 3].map(() => R.post(`/api/jobs/${job._id}/cancel`)));
    assert.equal(cancels.filter((r) => r.status === 200).length, 1);
    assert.equal((await R.get('/api/auth/me')).body.user.credits, 1000);
    // deleting the run does not give the month back
    await R.del(`/api/jobs/${job._id}`).expect(200);
    await R.post('/api/jobs').field('type', 'current').attach('file', sample('current_staff_sample.csv')).expect(429);
    // password change ends other sessions but keeps this one
    const R2 = client(app);
    await R2.post('/api/auth/login').send({ email: 'race@example.com', password: 'race-password-1' }).expect(200);
    await R.post('/api/auth/change-password').send({ currentPassword: 'race-password-1', newPassword: 'race-password-2' }).expect(200);
    await R.get('/api/auth/me').expect(200);
    await R2.get('/api/auth/me').expect(401);
    // cents never drift: 8.85 - 2.95 - 2.95 leaves exactly 2.95, and 2.95 can still be charged
    await admin.post(`/api/admin/users/${u._id}/credits`).send({ amount: -1000 }).expect(200);
    await admin.post(`/api/admin/users/${u._id}/credits`).send({ amount: 8.85 }).expect(200);
    for (let i = 0; i < 3; i++) await admin.post(`/api/admin/users/${u._id}/credits`).send({ amount: -2.95 }).expect(200);
    assert.equal((await R.get('/api/auth/me')).body.user.credits, 0);
    await Record.deleteMany({ user: u._id });
  });

  await t.test('oversized files are refused before they use memory', async () => {
    const big = Buffer.from(['Candidate (Last, Suffix First MI),Email Address', 'Doe, Jane,jane@example.com', ...Array(20001).fill('x,')].join('\n'));
    const r = await C.post('/api/jobs/preview').field('type', 'prehire').attach('file', big, 'big.csv');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /more than 20,000 rows/);
  });

  await t.test('disabled users are signed out immediately', async () => {
    await admin.patch(`/api/admin/users/${created._id}`).send({ active: false }).expect(200);
    await C.get('/api/jobs').expect(401);
  });

  await mongoose.connection.dropDatabase();
  await disconnectDb();
});

test('first-run setup cannot get stuck on bad input', { skip, timeout: 60000 }, async () => {
  const app = createApp();
  const { connectDb } = require('../server/db');
  await connectDb();
  await mongoose.connection.dropDatabase();
  const a = client(app);
  // a non-string name used to take the setup lock and then fail, locking setup forever
  await a.post('/api/auth/setup').send({ email: 'admin@example.com', password: 'admin-password-123', name: { x: 1 } }).expect(201);
  await mongoose.connection.dropDatabase();
  const User = require('../server/models/User');
  const Setting = require('../server/models/Setting');
  await Setting.create({ key: 'setupLock', value: {} }).catch(() => {});
  await Setting.deleteMany({});
  await a.post('/api/auth/setup').send({ email: 'admin2@example.com', password: 'admin-password-123' }).expect(201);
  assert.ok(await User.exists({ email: 'admin2@example.com', role: 'admin' }));
  await mongoose.connection.dropDatabase();
  await disconnectDb();
});
