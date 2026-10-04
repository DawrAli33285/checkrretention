// Account rules shared by sign-in, first-run setup, the admin screens and the
// password scripts, so every path applies the same checks.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const User = require('../models/User');
const AuthAttempt = require('../models/AuthAttempt');

const MIN = Math.max(6, config.minPasswordLength);
const PASSWORD_RULE = `Password must be ${MIN} to 200 characters.`;
const validPassword = (p) => typeof p === 'string' && p.length >= MIN && p.length <= 200;
const normalizeEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isBcrypt = (h) => typeof h === 'string' && /^\$2[aby]\$\d\d\$/.test(h);

/** Finds an account by email, ignoring case and stray spaces (older records were not always lowercased). */
async function findByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return (await User.findOne({ email: e })) || User.findOne({ email: { $regex: `^\\s*${escapeRe(e)}\\s*$`, $options: 'i' } });
}

/**
 * Checks a password. Accounts carried over from the old app may hold a
 * "password" field (plain text or bcrypt) instead of passwordHash; a correct
 * password upgrades that account to a hash and removes the old field.
 */
async function verifyPassword(user, password) {
  if (!user || typeof password !== 'string' || !password) return false;
  if (isBcrypt(user.passwordHash)) return bcrypt.compare(password, user.passwordHash);
  const raw = await User.collection.findOne({ _id: user._id }, { projection: { password: 1 } });
  const legacy = raw?.password;
  if (typeof legacy !== 'string' || !legacy) return false;
  let ok = false;
  if (isBcrypt(legacy)) ok = await bcrypt.compare(password, legacy);
  else {
    const a = Buffer.from(legacy); const b = Buffer.from(password);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (ok) {
    user.passwordHash = await bcrypt.hash(password, 12);
    await User.collection.updateOne({ _id: user._id }, { $set: { passwordHash: user.passwordHash, email: normalizeEmail(user.email) }, $unset: { password: '' } });
  }
  return ok;
}

const clearLockout = (email) => AuthAttempt.deleteMany({ key: `login:${normalizeEmail(email)}` });

/**
 * The administrator named in ADMIN_EMAIL / ADMIN_PASSWORD always exists, is an
 * active admin, and signs in with ADMIN_PASSWORD. This runs on every server
 * start, even when other admins already exist, so the hosting settings are the
 * single source of truth for that login. Other accounts are never touched.
 */
async function ensureEnvAdmin() {
  const email = normalizeEmail(config.bootstrapAdminEmail);
  const password = config.bootstrapAdminPassword;
  if (!email || !password) return { configured: false };
  let user = await findByEmail(email);
  let changed = false;
  if (!user) {
    user = new User({ email, name: 'Administrator', role: 'admin', active: true, passwordHash: await bcrypt.hash(password, 12) });
    await user.save();
    await clearLockout(email);
    console.log(`Admin account ready: ${email}`);
    return { configured: true, created: true };
  }
  if (user.email !== email) { user.email = email; changed = true; }
  if (user.role !== 'admin') { user.role = 'admin'; changed = true; }
  if (user.active === false) { user.active = true; changed = true; }
  if (!isBcrypt(user.passwordHash) || !(await bcrypt.compare(password, user.passwordHash))) {
    user.passwordHash = await bcrypt.hash(password, 12);
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    changed = true;
  }
  if (changed) {
    await user.save();
    await User.collection.updateOne({ _id: user._id }, { $unset: { password: '' } });
    console.log(`Admin account updated from ADMIN_EMAIL / ADMIN_PASSWORD: ${email}`);
  }
  await clearLockout(email);
  return { configured: true, updated: changed };
}

const isEnvAdmin = (user) => !!config.bootstrapAdminEmail && !!config.bootstrapAdminPassword && normalizeEmail(user?.email) === normalizeEmail(config.bootstrapAdminEmail);

module.exports = { MIN_PASSWORD: MIN, PASSWORD_RULE, validPassword, normalizeEmail, findByEmail, verifyPassword, ensureEnvAdmin, clearLockout, isEnvAdmin, isBcrypt };
