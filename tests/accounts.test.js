// Sign-in regression test. Needs a MongoDB at TEST_MONGODB_URI; skipped otherwise.
// Covers the live-site case: an administrator already exists in the database,
// and ADMIN_EMAIL / ADMIN_PASSWORD must still sign in.
const test = require('node:test');
const assert = require('node:assert/strict');

const uri = process.env.TEST_MONGODB_URI;
const skip = !uri && 'set TEST_MONGODB_URI to run the sign-in test';

Object.assign(process.env, {
  MONGODB_URI: uri ? uri.replace(/\/[^/]*$/, '/accounts_test') : '', JWT_SECRET: '',
  ADMIN_EMAIL: 'Owner@Example.com', ADMIN_PASSWORD: '12345678', MIN_PASSWORD_LENGTH: '', PROVIDER_MODE: 'demo', GEOCODER: 'none',
});

const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const H = { 'X-Requested-With': 'prognosticare' };

test('admin and client sign-in', { skip, timeout: 60000 }, async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  const users = mongoose.connection.db.collection('users');
  // State the env admin must override: another admin exists, the env email is a disabled client with another password,
  // the account is locked out, and an account from the old app stores a plain-text password.
  await users.insertMany([
    { email: 'someone-else@example.com', role: 'admin', active: true, passwordHash: await bcrypt.hash('other-admin-pass', 4) },
    { email: 'owner@example.com', role: 'client', active: false, passwordHash: await bcrypt.hash('old-password-1', 4) },
    { email: 'Old.Client@Example.com', password: 'oldpass88', credits: 10 },
  ]);
  await mongoose.connection.db.collection('authattempts').insertMany(Array.from({ length: 12 }, () => ({ key: 'login:owner@example.com', createdAt: new Date() })));
  await mongoose.disconnect();

  const { createApp } = require('../server/app');
  const app = createApp();
  const admin = request.agent(app);

  await t.test('ADMIN_EMAIL / ADMIN_PASSWORD signs in even when another admin exists', async () => {
    const r = await admin.post('/api/auth/login').set(H).send({ email: ' OWNER@example.com ', password: '12345678' });
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.user.role, 'admin');
    assert.equal((await admin.get('/api/auth/session')).body.user.email, 'owner@example.com');
  });

  await t.test('admin creates a client with an 8-character password and the client signs in', async () => {
    await admin.post('/api/admin/users').set(H).send({ email: 'Client@Hospital.org', password: '12345678', credits: 50 }).expect(201);
    await admin.post('/api/admin/users').set(H).send({ email: 'x@hospital.org', password: '1234567' }).expect(400);
    const c = request.agent(app);
    await c.post('/api/auth/login').set(H).send({ email: 'client@hospital.org', password: 'nope-nope' }).expect(401);
    const r = await c.post('/api/auth/login').set(H).send({ email: 'CLIENT@hospital.org', password: '12345678' }).expect(200);
    assert.equal(r.body.user.role, 'client');
    await c.get('/api/admin/users').expect(403);
    await c.get('/api/jobs').expect(200);
  });

  await t.test('an account from the old app signs in once and is upgraded', async () => {
    await request(app).post('/api/auth/login').set(H).send({ email: 'old.client@example.com', password: 'oldpass88' }).expect(200);
    const doc = await mongoose.connection.db.collection('users').findOne({ email: 'old.client@example.com' }); // the app's own open connection
    assert.ok(doc.passwordHash && !doc.password);
  });

  await t.test('the env admin password is changed in hosting settings, not in the app', async () => {
    const r = await admin.post('/api/auth/change-password').set(H).send({ currentPassword: '12345678', newPassword: 'something-new' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /ADMIN_PASSWORD/);
  });

  await require('../server/db').disconnectDb();
});
