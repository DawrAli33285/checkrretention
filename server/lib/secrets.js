// Session signing key. Uses JWT_SECRET when it is set. Otherwise the server
// generates a strong random key once, stores it in the database, and every
// instance reads the same one, so a deployment works with only MONGODB_URI.
const crypto = require('crypto');
const config = require('../config');
const Setting = require('../models/Setting');

let cached = null;

async function getJwtSecret() {
  if (config.jwtSecret) return config.jwtSecret;
  if (cached) return cached;
  const candidate = crypto.randomBytes(48).toString('hex');
  // Upsert only inserts when no key exists yet; concurrent instances all end up reading the same value.
  await Setting.updateOne({ key: 'jwtSecret' }, { $setOnInsert: { value: candidate } }, { upsert: true });
  const doc = await Setting.findOne({ key: 'jwtSecret' }).lean();
  cached = doc.value;
  return cached;
}

module.exports = { getJwtSecret };
