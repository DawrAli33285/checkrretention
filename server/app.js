const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { connectDb } = require('./db');
const User = require('./models/User');
const Invoice = require('./models/Invoice');
const { requireUser, requireAppHeader } = require('./middleware/auth');
const { mailEnabled } = require('./lib/mailer');
const { MODEL_VERSION } = require('./scoring/model');

// Optional: create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD. Without
// them, the sign-in page offers first-run setup instead.
let bootstrapDone = false;
async function bootstrapAdmin() {
  if (bootstrapDone) return;
  if (config.bootstrapAdminEmail && config.bootstrapAdminPassword && !(await User.exists({ role: 'admin' }))) {
    await User.updateOne(
      { email: config.bootstrapAdminEmail.toLowerCase() },
      { $setOnInsert: { name: 'Administrator' }, $set: { role: 'admin', active: true, passwordHash: await bcrypt.hash(config.bootstrapAdminPassword, 12) } },
      { upsert: true },
    );
    console.log(`Created first admin account ${config.bootstrapAdminEmail}`);
  }
  bootstrapDone = true; // only after success, so a failed attempt is retried on the next request
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Works before the database is configured, so a deployer can see what is missing.
  api.get('/health', async (req, res) => {
    let db = 'not configured';
    if (config.mongoUri) {
      try { await connectDb(); db = 'connected'; } catch (e) { db = `error: ${e.message}`; }
    }
    res.json({ ok: db === 'connected', db, providerMode: config.providersLive() ? 'live' : 'demo', modelVersion: MODEL_VERSION });
  });

  api.use(async (req, res, next) => {
    try { await connectDb(); await bootstrapAdmin(); return next(); } catch (e) {
      const err = new Error(config.mongoUri ? `The database could not be reached: ${e.message}` : e.message);
      err.status = 503; err.code = 'DATABASE_UNAVAILABLE';
      return next(err);
    }
  });
  api.use(requireAppHeader);

  // Public app settings the sign-in page needs.
  api.get('/config', async (req, res) => res.json({
    needsSetup: !(await User.exists({ role: 'admin' })),
    setupKeyRequired: !!config.setupToken,
    providerMode: config.providersLive() ? 'live' : 'demo',
    allowSelfRegister: config.allowSelfRegister,
    mailEnabled: mailEnabled(),
    pricePerRecord: { current: config.pricePerRecordCurrent, prehire: config.pricePerRecordPrehire },
    enableAgeFactor: config.enableAgeFactor,
    enforceMonthlyLimit: config.enforceMonthlyLimit,
    modelVersion: MODEL_VERSION,
  }));

  api.use('/auth', require('./routes/auth'));
  api.use('/jobs', require('./routes/jobs'));
  api.use('/admin', require('./routes/admin'));
  api.get('/invoices', requireUser, async (req, res) => {
    res.json({ invoices: await Invoice.find({ user: req.user._id }).sort({ createdAt: -1 }).lean() });
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    if (err.name === 'ValidationError' || err.name === 'CastError') status = 400;
    if (err.type === 'entity.parse.failed') status = 400;
    if (status >= 500 && status !== 503) console.error(err);
    const message = status >= 500 && status !== 503 && config.isProd ? 'Something went wrong. Please try again.' : err.message;
    res.status(status).json({ error: message, code: err.code, details: err.details });
  });

  app.use('/api', api);
  return app;
}

module.exports = { createApp };
