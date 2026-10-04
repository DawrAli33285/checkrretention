const express = require('express');
const multer = require('multer');
const config = require('../config');
const Job = require('../models/Job');
const Record = require('../models/Record');
const User = require('../models/User');
const RunReservation = require('../models/RunReservation');
const Setting = require('../models/Setting');
const { requireUser } = require('../middleware/auth');
const { parseFile, buildIntake } = require('../lib/intake');
const { stepJob, contactsRunThisMonth, periodOf, expiry, MODEL_VERSION } = require('../pipeline');
const { adjustCredits, round2 } = require('../lib/credits');
const { toRow, buildWorkbook, buildCsv, pointTables } = require('../lib/results');
const { notify } = require('../lib/mailer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

const MONTHLY_LIMIT_MSG = 'You have exceeded your processing limit for this month.';
const priceFor = (type) => (type === 'prehire' ? config.pricePerRecordPrehire : config.pricePerRecordCurrent);

function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB. Save it as CSV or split it into parts.` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Attach a .csv or .xlsx file.' });
    const type = req.body?.type;
    if (!['prehire', 'current'].includes(type)) return res.status(400).json({ error: 'Upload type must be "prehire" or "current".' });
    return next();
  });
}

async function analyse(req) {
  const type = req.body.type;
  const { headers, rows } = await parseFile(req.file.buffer, req.file.originalname, { maxRows: config.maxRowsPerFile });
  const previouslyRunContacts = await contactsRunThisMonth(req.user._id, type);
  const intake = buildIntake(type, headers, rows, { maxRecords: config.maxRecordsPerJob, previouslyRunContacts });
  const price = priceFor(type);
  const cost = round2(intake.stats.billable * price);
  return { type, intake, price, cost };
}

// The client's job site, else the default from JOB_SITE_LAT / JOB_SITE_LON. Anything that is not a
// real coordinate pair counts as "not set": commute distance then scores neutral instead of failing the upload.
const validSite = (s) => !!s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) && s.lat !== null && s.lon !== null && s.lat !== '' && s.lon !== ''
  && Math.abs(Number(s.lat)) <= 90 && Math.abs(Number(s.lon)) <= 180;
function jobSiteFor(user) {
  if (validSite(user.jobSite)) return { label: String(user.jobSite.label || user.jobSite.address || ''), lat: Number(user.jobSite.lat), lon: Number(user.jobSite.lon) };
  if (validSite(config.defaultJobSite)) return { label: String(config.defaultJobSite.label || ''), lat: Number(config.defaultJobSite.lat), lon: Number(config.defaultJobSite.lon) };
  return null;
}

// One current-staff run per calendar month, plus any extra runs an admin
// granted for that month. A run takes a numbered slot by inserting a
// reservation row; the unique index makes parallel uploads race safely, and
// deleting a run does not give the month back. release() undoes a failed start.
async function reserveMonthlyRun(userId, type) {
  const noop = { ok: true, release: async () => {} };
  if (type !== 'current' || !config.enforceMonthlyLimit) return noop;
  const period = periodOf();
  const u = await User.findById(userId, { extraRuns: 1 }).lean();
  const slots = 1 + (u?.extraRuns?.period === period ? u.extraRuns.count || 0 : 0);
  for (let slot = 0; slot < slots; slot++) {
    try {
      const r = await RunReservation.create({ user: userId, period, slot });
      return { ok: true, release: () => RunReservation.deleteOne({ _id: r._id }) };
    } catch (e) {
      if (e.code !== 11000) throw e; // slot taken: try the next one
    }
  }
  return { ok: false };
}

async function monthlyRunUsed(userId, type) {
  if (type !== 'current' || !config.enforceMonthlyLimit) return false;
  const period = periodOf();
  const u = await User.findById(userId, { extraRuns: 1 }).lean();
  const slots = 1 + (u?.extraRuns?.period === period ? u.extraRuns.count || 0 : 0);
  return (await RunReservation.countDocuments({ user: userId, period })) >= slots;
}

async function loadOwnedJob(req, res) {
  const job = await Job.findById(req.params.id).catch(() => null);
  if (!job || (String(job.user) !== String(req.user._id) && req.user.role !== 'admin')) {
    res.status(404).json({ error: 'Job not found.' });
    return null;
  }
  return job;
}

router.use(requireUser);

router.get('/', async (req, res) => {
  const q = { user: req.user._id };
  if (['prehire', 'current'].includes(req.query.type)) q.type = req.query.type;
  const jobs = await Job.find(q).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ jobs });
});

// Validate a file and quote the cost without creating anything.
router.post('/preview', receiveFile, async (req, res) => {
  if (await monthlyRunUsed(req.user._id, req.body.type)) return res.status(429).json({ error: MONTHLY_LIMIT_MSG });
  const { type, intake, price, cost } = await analyse(req);
  const sample = intake.records.filter((r) => !r.skipReason).slice(0, 5).map((r) => ({ name: r.rec.name, email: r.rec.email, jobClass: r.rec.jobClass, department: r.rec.department }));
  const mapping = Object.fromEntries(Object.entries(intake.headerMap).map(([k, v]) => [k, v[0]]));
  res.json({
    type, fileName: req.file.originalname, stats: intake.stats, issues: intake.issues, mapping, sample,
    pricePerRecord: price, cost, credits: req.user.credits, enoughCredits: req.user.credits >= cost,
    turnoverClasses: intake.turnover.length,
    providerMode: config.providersLive() ? 'live' : 'demo',
  });
});

// Create the job, charge credits, queue every record. Every step after the
// monthly reservation is undone (credits returned, month released) if a later step fails.
router.post('/', receiveFile, async (req, res) => {
  const type = req.body.type;
  const reservation = await reserveMonthlyRun(req.user._id, type);
  if (!reservation.ok) return res.status(429).json({ error: MONTHLY_LIMIT_MSG });

  let charged = 0;
  let job = null;
  try {
    const { intake, price, cost } = await analyse(req);
    if (cost > 0) {
      const after = await adjustCredits(req.user._id, -cost);
      if (!after) {
        const bal = (await User.findById(req.user._id, { credits: 1 }).lean())?.credits || 0;
        const err = new Error(`This file costs $${cost.toFixed(2)} (${intake.stats.billable} records x $${price.toFixed(2)}). Your balance is $${bal.toFixed(2)}. Contact PrognostiCare to add credits.`);
        err.status = 402;
        throw err;
      }
      charged = cost;
    }
    const period = periodOf();
    job = await Job.create({
      user: req.user._id, type, fileName: String(req.file.originalname).slice(0, 200), period,
      providerMode: config.providersLive() ? 'live' : 'demo', modelVersion: MODEL_VERSION,
      settings: { enableAge: config.enableAgeFactor, lookbackDays: config.socialLookbackDays, jobSite: jobSiteFor(req.user) },
      counts: { rows: intake.stats.rows, scored: intake.stats.billable, skipped: intake.records.length - intake.stats.billable },
      cost, pricePerRecord: price, turnover: intake.turnover, issues: intake.issues, expiresAt: expiry(),
    });
    const docs = intake.records.map((r) => ({
      job: job._id, user: req.user._id, rowIndex: r.rowIndex, contactKey: r.contactKey, period, jobType: type,
      status: r.skipReason ? 'skipped' : 'pending', skipReason: r.skipReason || undefined, input: r.rec, expiresAt: job.expiresAt,
    }));
    for (let i = 0; i < docs.length; i += 1000) await Record.insertMany(docs.slice(i, i + 1000), { ordered: true });
    // Save the turnover table for later pre-hire runs.
    if (intake.turnover.length) {
      await User.updateOne({ _id: req.user._id }, { $set: { turnoverTable: intake.turnover.map((t) => ({ ...t, updatedAt: new Date() })) } });
    }
    notify(`New ${type === 'prehire' ? 'pre-hire' : 'current staff'} upload: ${job.fileName}`, `${req.user.email} uploaded ${job.fileName} (${intake.stats.billable} records, $${cost.toFixed(2)}). Job ${job._id}.`).catch(() => {});
    return res.status(201).json({ job });
  } catch (e) {
    if (job) { await Record.deleteMany({ job: job._id }).catch(() => {}); await Job.deleteOne({ _id: job._id }).catch(() => {}); }
    if (charged) await adjustCredits(req.user._id, charged).catch((err) => console.error('Refund failed', req.user._id, charged, err));
    await reservation.release().catch(() => {});
    throw e;
  }
});

router.get('/:id', async (req, res) => {
  const job = await loadOwnedJob(req, res); if (!job) return;
  res.json({ job });
});

// Advance processing. The browser calls this in a loop until status is completed.
router.post('/:id/step', async (req, res) => {
  const job = await loadOwnedJob(req, res); if (!job) return;
  if (!['queued', 'processing'].includes(job.status)) return res.json({ job });
  const out = await stepJob(job._id);
  res.json({ job: out.job, busy: out.busy, recent: out.recent || [] });
});

router.get('/:id/results', async (req, res) => {
  const job = await loadOwnedJob(req, res); if (!job) return;
  const records = await Record.find({ job: job._id }).sort({ rowIndex: 1 }).lean();
  res.json({ job, rows: records.map(toRow), model: pointTables() });
});

router.get('/:id/export', async (req, res) => {
  const job = await loadOwnedJob(req, res); if (!job) return;
  const records = await Record.find({ job: job._id }).sort({ rowIndex: 1 }).lean();
  const rows = records.map(toRow);
  const base = `${job.type === 'prehire' ? 'prehire' : 'staff'}-retention-${job.createdAt.toISOString().slice(0, 10)}${job.providerMode === 'demo' ? '-DEMO' : ''}`;
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(buildCsv(job, rows));
  }
  const buf = await buildWorkbook(job, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
  return res.send(Buffer.from(buf));
});

// Stop a job. Records not yet scored are refunded. The status change is claimed
// atomically first, so repeated or parallel cancels refund exactly once.
router.post('/:id/cancel', async (req, res) => {
  const job = await loadOwnedJob(req, res); if (!job) return;
  // A unique row per job makes the refund happen once even if Stop is pressed repeatedly.
  try { await Setting.create({ key: `cancel:${job._id}`, value: { at: new Date() } }); } catch {
    return res.status(400).json({ error: 'This run has already been stopped.' });
  }
  const claimed = await Job.findOneAndUpdate({ _id: job._id, status: { $in: ['queued', 'processing', 'failed'] } }, { $set: { status: 'cancelled', lockedUntil: null } }, { new: true });
  if (!claimed) { await Setting.deleteOne({ key: `cancel:${job._id}` }); return res.status(400).json({ error: 'Only unfinished runs can be stopped.' }); }
  const r = await Record.updateMany({ job: job._id, status: { $in: ['pending', 'processing'] } }, { $set: { status: 'skipped', skipReason: 'Run stopped' } });
  const unscored = r.modifiedCount || 0;
  const refund = round2(unscored * (job.pricePerRecord || 0));
  if (refund > 0) await adjustCredits(job.user, refund);
  const updated = await Job.findByIdAndUpdate(job._id, { $inc: { cost: -refund, 'counts.skipped': unscored } }, { new: true });
  res.json({ job: updated, refund });
});

router.delete('/:id', async (req, res) => {
  const job = await loadOwnedJob(req, res); if (!job) return;
  if (['queued', 'processing', 'failed'].includes(job.status)) return res.status(400).json({ error: 'Stop the run first. Unscored records are refunded when a run is stopped.' });
  await Record.deleteMany({ job: job._id });
  await job.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
