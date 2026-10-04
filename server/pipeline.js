// Job pipeline. Designed for serverless: an upload creates a Job plus one
// Record per row; processing happens in short "steps" (each well under the
// function time limit) that the browser keeps calling until the job is done.
// Any step can be resumed by any instance because all state lives in MongoDB.
const config = require('./config');
const Job = require('./models/Job');
const Record = require('./models/Record');
const User = require('./models/User');
const { scoreRetention, DOMAINS, MODEL_VERSION } = require('./scoring/model');
const { scorePosts } = require('./scoring/signals');
const { enrich } = require('./providers/enrichment');
const { collectPosts } = require('./providers/social');
const { commuteMiles } = require('./providers/geocode');
const { monthsBetween, yearsBetween } = require('./lib/normalize');
const { notify } = require('./lib/mailer');

const STEP_CONCURRENCY = Number(process.env.STEP_CONCURRENCY || 4);
const LEASE_MS = 90000;

const periodOf = (d = new Date()) => d.toISOString().slice(0, 7);
const expiry = () => new Date(Date.now() + config.dataRetentionDays * 86400000);
const norm = (s) => String(s || '').trim().toLowerCase();

function lookupTurnover(jobClass, ...tables) {
  const key = norm(jobClass);
  if (!key) return null;
  for (const table of tables) {
    const hit = (table || []).find((t) => norm(t.jobClass) === key);
    if (hit && hit.pct != null) return hit.pct;
  }
  return null;
}

async function processRecord(record, job, user, { live, deadline }) {
  const rec = record.input;
  const flags = [];
  if (!live) flags.push('Demo data: social signals are simulated');

  // 1. Identity resolution
  const enrichment = await enrich(rec, live, deadline);
  if (!enrichment.matched) flags.push('No social profile match');

  // 2. Social listening
  let signals = { postsConsidered: 0, domains: {}, evidence: [] };
  let providerErrors = [];
  if (enrichment.matched) {
    const { posts, errors } = await collectPosts(enrichment, { live, deadline, seedKey: record.contactKey });
    providerErrors = errors;
    signals = scorePosts(posts, { lookbackDays: job.settings?.lookbackDays || config.socialLookbackDays });
    if (errors.length) flags.push('Some social networks could not be read');
    if (signals.postsConsidered === 0) flags.push('No recent public posts');
  }

  const domains = {}; let fromSignal = 0; let fromProvided = 0;
  for (const d of DOMAINS) {
    const s = signals.domains?.[d.key];
    const p = rec.providedDomains?.[d.key];
    if (s != null) { domains[d.key] = s; fromSignal++; } else if (p != null) { domains[d.key] = p; fromProvided++; } else domains[d.key] = null;
  }
  let socialSource = 'none';
  if (fromSignal) socialSource = live ? 'social' : 'demo';
  else if (fromProvided) socialSource = 'provided';
  if (fromProvided) flags.push('Uses client-provided domain scores');

  // 3. Structural factors
  const now = new Date();
  let tenureMonths = null; let tenureSource = 'unknown';
  if (job.type === 'current' && rec.hireDate) { tenureMonths = monthsBetween(new Date(rec.hireDate), now); tenureSource = 'hire date'; }
  else if (job.type === 'prehire' && enrichment.jobStartDate) { tenureMonths = monthsBetween(new Date(enrichment.jobStartDate), now); tenureSource = live ? 'current employer (enrichment)' : 'current employer (demo)'; }
  if (tenureMonths === null) flags.push('Tenure unknown');

  let ageYears = null;
  if (job.settings?.enableAge && job.type === 'current' && rec.dateOfBirth) ageYears = yearsBetween(new Date(rec.dateOfBirth), now);

  const dist = await commuteMiles(rec, job.settings?.jobSite);
  if (dist.miles === null) flags.push(`Distance unknown (${dist.source})`);

  let turnoverPct = rec.turnoverPct; let turnoverSource = turnoverPct != null ? 'file' : 'unknown';
  if (turnoverPct == null) {
    turnoverPct = lookupTurnover(rec.jobClass, job.turnover, user.turnoverTable);
    if (turnoverPct != null) turnoverSource = 'job class turnover table';
  }
  if (turnoverPct == null) flags.push('Turnover unknown for job class');

  // 4. Score
  const score = scoreRetention({ ageYears, distanceMiles: dist.miles, tenureMonths, turnoverPct, domains }, { enableAge: job.settings?.enableAge });

  record.enrichment = { source: enrichment.source, matched: enrichment.matched, likelihood: enrichment.likelihood, profiles: enrichment.profiles, jobStartDate: enrichment.jobStartDate || null };
  record.social = {
    source: socialSource,
    postsConsidered: signals.postsConsidered,
    domains,
    insight: { jobSatisfaction: signals.domains?.jobSatisfaction ?? null },
    evidence: (signals.evidence || []).slice(0, 25),
    providerErrors,
  };
  record.factors = { ageYears, distanceMiles: dist.miles, distanceSource: dist.source, tenureMonths, tenureSource, turnoverPct, turnoverSource };
  record.score = score;
  record.flags = flags;
  record.status = 'done';
  record.processedAt = new Date();
}

async function refreshCounts(job) {
  const agg = await Record.aggregate([{ $match: { job: job._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const c = Object.fromEntries(agg.map((a) => [a._id, a.n]));
  job.counts.done = c.done || 0;
  job.counts.errors = c.error || 0;
  job.counts.skipped = c.skipped || 0;
  return (c.pending || 0) + (c.processing || 0);
}

// Writes a record's result only if it is still "processing". If the run was
// stopped meanwhile, the record was already marked skipped and refunded, and
// that must win: it is never both refunded and scored.
async function saveResult(r) {
  const fields = { status: r.status, enrichment: r.enrichment, social: r.social, factors: r.factors, score: r.score, flags: r.flags, error: r.error, processedAt: r.processedAt };
  const res = await Record.updateOne({ _id: r._id, status: 'processing' }, { $set: fields });
  return res.modifiedCount > 0;
}

/**
 * Process as many records as fit in the time budget. Safe to call from
 * several tabs or server instances at once: a lease on the job and atomic
 * record claims prevent double work, and every final write is conditional so a
 * stopped run stays stopped.
 */
async function stepJob(jobId, { budgetMs = config.stepBudgetMs } = {}) {
  const started = Date.now();
  const now = new Date();
  const job = await Job.findOneAndUpdate(
    { _id: jobId, status: { $in: ['queued', 'processing'] }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(Date.now() + LEASE_MS), status: 'processing' } },
    { new: true },
  );
  if (!job) {
    const current = await Job.findById(jobId);
    return { job: current, busy: !!current && ['queued', 'processing'].includes(current.status), recent: [] };
  }

  // Records stuck in "processing" from a crashed step go back to the queue.
  await Record.updateMany({ job: job._id, status: 'processing', updatedAt: { $lt: new Date(Date.now() - LEASE_MS) } }, { $set: { status: 'pending' } });

  const user = await User.findById(job.user).lean();
  const live = job.providerMode === 'live';
  const deadline = started + budgetMs;
  const recent = [];
  let failure = null;

  try {
    let keepGoing = true;
    while (keepGoing && !failure && Date.now() < deadline - 3000) {
      const claimed = [];
      for (let i = 0; i < STEP_CONCURRENCY; i++) {
        const r = await Record.findOneAndUpdate({ job: job._id, status: 'pending' }, { $set: { status: 'processing' } }, { new: true, sort: { rowIndex: 1 } });
        if (!r) { keepGoing = false; break; }
        claimed.push(r);
      }
      if (!claimed.length) break;
      await Promise.all(claimed.map(async (r) => {
        try {
          await processRecord(r, job, user, { live, deadline: deadline + 10000 });
        } catch (e) {
          if (e.quota) { failure = e.message; await Record.updateOne({ _id: r._id, status: 'processing' }, { $set: { status: 'pending' } }); return; }
          r.status = 'error'; r.error = String(e.message || e).slice(0, 500);
        }
        if (await saveResult(r)) {
          recent.push({ name: r.input?.name || '', status: r.status, band: r.score?.band || null, score: r.score?.retentionScore ?? null, signal: r.social?.source || null });
        }
      }));
    }
  } catch (e) {
    failure = String(e.message || e).slice(0, 500);
    await Record.updateMany({ job: job._id, status: 'processing' }, { $set: { status: 'pending' } });
  }

  const remaining = await refreshCounts(job);
  const set = { lockedUntil: null, counts: job.toObject().counts };
  if (!job.startedAt) set.startedAt = now;
  if (failure) { set.status = 'failed'; set.error = failure; } else if (remaining === 0) { set.status = 'completed'; set.completedAt = new Date(); }
  // Conditional: never overwrite a run that was stopped while this step ran.
  const saved = await Job.findOneAndUpdate({ _id: job._id, status: 'processing' }, { $set: set }, { new: true });
  if (saved?.status === 'completed') {
    notify(`Retention results ready: ${saved.fileName}`, `Job ${saved._id} finished: ${saved.counts.done} scored, ${saved.counts.errors} errors.`, user?.email).catch(() => {});
  }
  return { job: saved || (await Job.findById(job._id)), busy: false, recent };
}

/** Contacts already processed for this client this month (one run per contact per month). */
async function contactsRunThisMonth(userId, type) {
  if (type !== 'current') return new Set();
  const keys = await Record.distinct('contactKey', { user: userId, jobType: 'current', period: periodOf(), status: { $in: ['pending', 'processing', 'done'] } });
  return new Set(keys);
}

module.exports = { stepJob, processRecord, contactsRunThisMonth, periodOf, expiry, lookupTurnover, MODEL_VERSION };
