const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { getJwtSecret } = require('../lib/secrets');

const COOKIE = 'pc_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Sessions live in an httpOnly cookie, so page scripts can never read the token.
async function startSession(req, res, user) {
  const token = jwt.sign({ sub: String(user._id), sv: user.sessionVersion || 0 }, await getJwtSecret(), { expiresIn: Math.floor(MAX_AGE_MS / 1000) });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure || config.isProd, maxAge: MAX_AGE_MS, path: '/' });
}

function endSession(req, res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure || config.isProd, path: '/' });
}

// Reads the session cookie and loads the user fresh from the database, so
// disabling a user or changing their role takes effect immediately.
// Returns { user } or { error } (and clears a bad cookie).
async function loadSessionUser(req, res) {
  const token = readCookie(req, COOKIE);
  if (!token) return { error: 'Please sign in.' };
  let payload;
  try {
    payload = jwt.verify(token, await getJwtSecret());
  } catch (e) {
    endSession(req, res);
    return { error: e.name === 'TokenExpiredError' ? 'Your session expired. Please sign in again.' : 'Please sign in again.' };
  }
  const user = await User.findById(payload.sub);
  if (!user || user.active === false) { endSession(req, res); return { error: 'Account not found or disabled.' }; }
  // A password change or reset bumps sessionVersion and ends every older session.
  if ((payload.sv || 0) !== (user.sessionVersion || 0)) { endSession(req, res); return { error: 'Please sign in again.' }; }
  return { user };
}

async function requireUser(req, res, next) {
  const { user, error } = await loadSessionUser(req, res);
  if (!user) return res.status(401).json({ error });
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  return next();
}

// Cross-site request protection: browsers cannot add custom headers to a
// cross-site form post, and SameSite=Lax keeps the cookie off cross-site requests.
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'prognosticare') return res.status(403).json({ error: 'Request blocked. Reload the page and try again.' });
  return next();
}

module.exports = { startSession, endSession, loadSessionUser, requireUser, requireAdmin, requireAppHeader };
