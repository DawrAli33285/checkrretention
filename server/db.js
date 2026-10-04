// Cached Mongoose connection that survives across serverless invocations.
const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);
let cached = global.__mongoose || (global.__mongoose = { conn: null, promise: null });

async function connectDb(uri = config.mongoUri) {
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;
  if (!uri) {
    const err = new Error('MONGODB_URI is not set. Add it in Vercel > Settings > Environment Variables (or .env locally).');
    err.status = 503;
    throw err;
  }
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 }).then((m) => m);
  }
  try {
    cached.conn = await cached.promise;
    // Make sure every index exists before handling requests. Unique indexes are
    // what makes monthly reservations and one-time locks safe under parallel requests.
    if (!cached.indexed) { await ensureIndexes(); cached.indexed = true; }
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}

async function ensureIndexes() {
  // Load every model so its indexes are known, then build them.
  require('./models/User'); require('./models/Job'); require('./models/Record'); require('./models/Invoice');
  require('./models/GeoCache'); require('./models/Setting'); require('./models/AuthAttempt'); require('./models/RunReservation');
  // Each model separately: a database that lacks one feature (some MongoDB-compatible
  // services have no TTL indexes) still gets every other model's indexes.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes().catch((e) => console.warn(`Index setup for ${m.modelName}: ${e.message}`))));
}

async function disconnectDb() {
  await mongoose.disconnect();
  cached.conn = null;
  cached.promise = null;
  cached.indexed = false;
}

module.exports = { connectDb, disconnectDb, ensureIndexes };
