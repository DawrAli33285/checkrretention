const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/User');
const Job = require('../models/Job');
const Record = require('../models/Record');
const Invoice = require('../models/Invoice');
const { requireUser, requireAdmin } = require('../middleware/auth');
const { geocode } = require('../providers/geocode');
const { periodOf, MODEL_VERSION } = require('../pipeline');
const { sendMail, mailEnabled } = require('../lib/mailer');
const { adjustCredits } = require('../lib/credits');

const router = express.Router();
router.use(requireUser, requireAdmin);

const round2 = (n) => Math.round(n * 100) / 100;

router.get('/system', (req, res) => {
  res.json({
    providerMode: config.providersLive() ? 'live' : 'demo',
    providerSetting: config.providerMode,
    keys: { peopleDataLabs: !!config.pdlApiKey, rapidApi: !!config.rapidApiKey },
    mail: mailEnabled(),
    modelVersion: MODEL_VERSION,
    enableAgeFactor: config.enableAgeFactor,
    enforceMonthlyLimit: config.enforceMonthlyLimit,
    pricePerRecord: { current: config.pricePerRecordCurrent, prehire: config.pricePerRecordPrehire },
    dataRetentionDays: config.dataRetentionDays,
    defaultJobSite: config.defaultJobSite,
  });
});

router.get('/stats', async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const [users, jobs, jobs30, records30, revenue] = await Promise.all([
    User.countDocuments({ role: 'client' }),
    Job.countDocuments(),
    Job.countDocuments({ createdAt: { $gte: since } }),
    Record.countDocuments({ status: 'done', processedAt: { $gte: since } }),
    Job.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: '$cost' } } }]),
  ]);
  const recent = await Job.find().sort({ createdAt: -1 }).limit(10).populate('user', 'email organization').lean();
  res.json({ users, jobs, jobs30, records30, revenue30: round2(revenue[0]?.total || 0), recent });
});

// ---------------------------------------------------------------- users
router.get('/users', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  users.forEach((u) => { delete u.passwordHash; delete u.resetTokenHash; });
  res.json({ users });
});

router.post('/users', async (req, res) => {
  const { email, password, name = '', organization = '', role = 'client', credits = 0 } = req.body || {};
  const e = String(email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Temporary password must be at least 10 characters.' });
  if (await User.exists({ email: e })) return res.status(409).json({ error: 'That email already has an account.' });
  const user = await User.create({ email: e, name: String(name).slice(0, 120), organization: String(organization).slice(0, 120), role: role === 'admin' ? 'admin' : 'client', credits: Math.min(1000000, Math.max(0, Math.round((Number(credits) || 0) * 100) / 100)), passwordHash: await bcrypt.hash(password, 12) });
  res.status(201).json({ user: user.toSafeJSON() });
});

router.patch('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const b = req.body || {};
  if (b.name !== undefined) user.name = String(b.name);
  if (b.organization !== undefined) user.organization = String(b.organization);
  if (b.active !== undefined) {
    if (String(user._id) === String(req.user._id) && !b.active) return res.status(400).json({ error: 'You cannot disable your own account.' });
    if (user.active && !b.active) user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.active = !!b.active;
  }
  if (b.role !== undefined) {
    if (String(user._id) === String(req.user._id) && b.role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own admin role.' });
    user.role = b.role === 'admin' ? 'admin' : 'client';
  }
  if (b.password) {
    if (String(b.password).length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    user.passwordHash = await bcrypt.hash(String(b.password), 12);
    user.sessionVersion = (user.sessionVersion || 0) + 1;
  }
  if (b.grantExtraRun) {
    const period = periodOf();
    user.extraRuns = { period, count: (user.extraRuns?.period === period ? user.extraRuns.count || 0 : 0) + 1 };
  }
  if (b.jobSite) {
    const js = { label: String(b.jobSite.label || ''), address: String(b.jobSite.address || ''), lat: b.jobSite.lat ?? null, lon: b.jobSite.lon ?? null };
    if ((js.lat === null || js.lon === null || js.lat === '' || js.lon === '') && js.address) {
      const loc = await geocode(js.address);
      if (!loc) return res.status(400).json({ error: 'Could not locate that address. Enter latitude and longitude instead.' });
      js.lat = loc.lat; js.lon = loc.lon;
    }
    js.lat = js.lat === '' || js.lat === null ? null : Number(js.lat);
    js.lon = js.lon === '' || js.lon === null ? null : Number(js.lon);
    user.jobSite = js;
  }
  await user.save();
  res.json({ user: user.toSafeJSON() });
});

router.post('/users/:id/credits', async (req, res) => {
  const amount = round2(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Enter a non-zero amount.' });
  if (Math.abs(amount) > 1000000) return res.status(400).json({ error: 'Amount is too large.' });
  const user = await adjustCredits(req.params.id, amount).catch(() => null);
  if (!user) return res.status(400).json({ error: 'User not found, or the balance would go below zero.' });
  res.json({ user: user.toSafeJSON() });
});

router.delete('/users/:id', async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  await Record.deleteMany({ user: user._id });
  await Job.deleteMany({ user: user._id });
  await Invoice.deleteMany({ user: user._id });
  await user.deleteOne();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- jobs
router.get('/jobs', async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  const jobs = await Job.find(q).sort({ createdAt: -1 }).limit(300).populate('user', 'email organization').lean();
  res.json({ jobs });
});

router.post('/jobs/:id/resume', async (req, res) => {
  const job = await Job.findById(req.params.id).catch(() => null);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!['failed', 'processing'].includes(job.status)) return res.status(400).json({ error: 'Only failed or stuck jobs can be resumed.' });
  await Record.updateMany({ job: job._id, status: { $in: ['processing', 'error'] } }, { $set: { status: 'pending' }, $unset: { error: 1 } });
  job.status = 'queued'; job.error = undefined; job.lockedUntil = null;
  await job.save();
  res.json({ job });
});

// ---------------------------------------------------------------- invoices
router.get('/invoices', async (req, res) => {
  const invoices = await Invoice.find().sort({ createdAt: -1 }).populate('user', 'email organization').lean();
  res.json({ invoices });
});

router.post('/invoices', async (req, res) => {
  const { userId, amount, description = '', email = true } = req.body || {};
  const user = await User.findById(userId).catch(() => null);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const amt = round2(Number(amount));
  if (!(amt > 0) || amt > 1000000) return res.status(400).json({ error: 'Enter an amount between $0.01 and $1,000,000.' });
  const invoice = await Invoice.create({ user: user._id, amount: amt, description, createdBy: req.user._id });
  let emailed = false;
  if (email) emailed = await sendMail(user.email, `Invoice #${String(invoice._id).slice(-8).toUpperCase()} from PrognostiCare`, `Amount due: $${amt.toFixed(2)}\n${description ? `\n${description}\n` : ''}\nOnce payment is received, the amount is added to your account credits.`).catch(() => false);
  res.status(201).json({ invoice, emailed });
});

router.post('/invoices/:id/paid', async (req, res) => {
  const invoice = await Invoice.findOneAndUpdate({ _id: req.params.id, status: 'Unpaid' }, { $set: { status: 'Paid', paidAt: new Date() } }, { new: true }).catch(() => null);
  if (!invoice) return res.status(400).json({ error: 'Invoice not found or not unpaid.' });
  await adjustCredits(invoice.user, invoice.amount);
  res.json({ invoice });
});

router.post('/invoices/:id/void', async (req, res) => {
  const invoice = await Invoice.findOneAndUpdate({ _id: req.params.id, status: 'Unpaid' }, { $set: { status: 'Void' } }, { new: true }).catch(() => null);
  if (!invoice) return res.status(400).json({ error: 'Only unpaid invoices can be voided.' });
  res.json({ invoice });
});

module.exports = router;
