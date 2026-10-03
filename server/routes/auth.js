const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const User = require('../models/User');
const Setting = require('../models/Setting');
const AuthAttempt = require('../models/AuthAttempt');
const { startSession, endSession, loadSessionUser, requireUser } = require('../middleware/auth');
const { sendMail, mailEnabled } = require('../lib/mailer');

const router = express.Router();

// Coarse per-instance limits by IP. Successful sign-ins do not count, so an
// office of many people behind one IP is not locked out.
const limit = (max, extra = {}) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' }, ...extra });
const loginLimiter = limit(60, { skipSuccessfulRequests: true });
const setupLimiter = limit(20);
const registerLimiter = limit(20);
const resetLimiter = limit(20);

// Per-account lockout shared by every server instance: 10 failed sign-ins for
// one email within 15 minutes blocks that email for the rest of the window.
const MAX_FAILURES = 10;

const str = (v) => (typeof v === 'string' ? v : '');
const validPassword = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 200;
const PASSWORD_RULE = 'Password must be 10 to 200 characters.';
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && e.length <= 254;
const cleanText = (v, max = 120) => str(v).trim().slice(0, max);
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const SETUP_DONE = { error: 'Setup is already complete. Please sign in.' };

// First-run setup: while no admin exists, the first visitor creates the admin
// account from the sign-in page. If SETUP_TOKEN is set, that key is required too.
router.post('/setup', setupLimiter, async (req, res) => {
  const email = str(req.body?.email).toLowerCase().trim();
  const password = req.body?.password;
  const name = cleanText(req.body?.name);
  const organization = cleanText(req.body?.organization);
  if (await User.exists({ role: 'admin' })) return res.status(409).json(SETUP_DONE);
  if (config.setupToken && str(req.body?.setupKey) !== config.setupToken) return res.status(403).json({ error: 'The setup key is not correct.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const passwordHash = await bcrypt.hash(password, 12);

  // One-time lock so two simultaneous attempts cannot both succeed. It is
  // released if creating the admin fails, so setup can never get stuck.
  try {
    await Setting.create({ key: 'setupLock', value: { at: new Date(), by: email } });
  } catch {
    return res.status(409).json(SETUP_DONE);
  }
  try {
    const user = await User.findOneAndUpdate(
      { email },
      { $set: { role: 'admin', active: true, name, organization, passwordHash } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await startSession(req, res, user);
    return res.status(201).json({ user: user.toSafeJSON() });
  } catch (e) {
    await Setting.deleteOne({ key: 'setupLock' }).catch(() => {});
    throw e;
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = str(req.body?.email).toLowerCase().trim();
  const password = str(req.body?.password);
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
  const key = `login:${email}`;
  if ((await AuthAttempt.countDocuments({ key })) >= MAX_FAILURES) {
    return res.status(429).json({ error: 'Too many failed sign-in attempts for this account. Wait 15 minutes or ask your administrator to reset your password.' });
  }
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  // Same message for unknown email and wrong password (no account enumeration).
  if (!user || !user.active || !user.passwordHash || !ok) {
    await AuthAttempt.create({ key });
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  await AuthAttempt.deleteMany({ key });
  user.lastLoginAt = new Date();
  await user.save();
  await startSession(req, res, user);
  return res.json({ user: user.toSafeJSON() });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.post('/register', registerLimiter, async (req, res) => {
  if (!config.allowSelfRegister) return res.status(403).json({ error: 'Self-registration is disabled. Ask your PrognostiCare contact for an account.' });
  const email = str(req.body?.email).toLowerCase().trim();
  const password = req.body?.password;
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists.' });
  // Only whitelisted fields: a client can never set its own role or credits.
  const user = await User.create({ email, name: cleanText(req.body?.name), organization: cleanText(req.body?.organization), passwordHash: await bcrypt.hash(password, 12), credits: config.newUserCredits });
  await startSession(req, res, user);
  return res.status(201).json({ user: user.toSafeJSON() });
});

router.get('/me', requireUser, (req, res) => res.json({ user: req.user.toSafeJSON() }));

// Session check for page loads: 200 with user null when signed out, so a
// signed-out visit does not log an error in the browser console.
router.get('/session', async (req, res) => {
  const { user } = await loadSessionUser(req, res);
  res.json({ user: user ? user.toSafeJSON() : null });
});

router.post('/change-password', requireUser, async (req, res) => {
  const newPassword = req.body?.newPassword;
  if (!(await bcrypt.compare(str(req.body?.currentPassword), req.user.passwordHash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!validPassword(newPassword)) return res.status(400).json({ error: PASSWORD_RULE });
  req.user.passwordHash = await bcrypt.hash(newPassword, 12);
  req.user.sessionVersion = (req.user.sessionVersion || 0) + 1; // signs out every other device
  await req.user.save();
  await startSession(req, res, req.user); // keep this device signed in
  return res.json({ ok: true });
});

// Password reset by emailed one-time link (only when SMTP is configured).
router.post('/forgot', resetLimiter, async (req, res) => {
  const email = str(req.body?.email).toLowerCase().trim();
  const generic = { ok: true, message: 'If that account exists, a reset link has been emailed.' };
  if (!mailEnabled()) return res.status(503).json({ error: 'Password reset email is not configured. Ask an administrator to reset your password.' });
  // The link must point at our own address, never at whatever Host header a request claims.
  if (!config.appUrl && config.isProd) return res.status(503).json({ error: 'Password reset is not available until APP_URL is set. Ask an administrator to reset your password.' });
  const user = await User.findOne({ email, active: true });
  if (!user) return res.json(generic);
  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  user.resetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();
  const base = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  await sendMail(user.email, 'Reset your password', `Use this link within 1 hour to set a new password:\n\n${base}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this email.`);
  return res.json(generic);
});

router.post('/reset', resetLimiter, async (req, res) => {
  const newPassword = req.body?.newPassword;
  if (!validPassword(newPassword)) return res.status(400).json({ error: PASSWORD_RULE });
  const hash = crypto.createHash('sha256').update(str(req.body?.token)).digest('hex');
  const user = await User.findOne({ resetTokenHash: hash, resetExpires: { $gt: new Date() } });
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.resetTokenHash = null; user.resetExpires = null;
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();
  await AuthAttempt.deleteMany({ key: `login:${user.email}` });
  return res.json({ ok: true });
});

module.exports = router;
