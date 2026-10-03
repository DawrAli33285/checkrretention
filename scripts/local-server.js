// Local API server for development (npm run dev) and for a self-hosted run
// (npm start also serves the built frontend). Vercel does not use this file.
//
// Zero-config: when MONGODB_URI is not set, a private MongoDB is started on
// this machine with its data kept in ./.localdb, so `npm install && npm run dev`
// works with no setup. The first run downloads the MongoDB binary (~70 MB).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const express = require('express');

async function startLocalDatabase() {
  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = require('mongodb-memory-server-core'));
  } catch {
    return null; // dev dependency not installed (production install)
  }
  const dbPath = path.join(__dirname, '..', '.localdb');
  fs.mkdirSync(dbPath, { recursive: true });
  console.log('MONGODB_URI is not set: starting a local database in ./.localdb (first run downloads MongoDB, about a minute)...');
  const server = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger', port: Number(process.env.LOCAL_DB_PORT || 27027) } });
  const shutdown = async () => { await server.stop({ doCleanup: false }).catch(() => {}); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  return server.getUri('prognosticare');
}

(async () => {
  if (!process.env.MONGODB_URI) {
    try {
      const uri = await startLocalDatabase();
      if (uri) { process.env.MONGODB_URI = uri; console.log(`Local database ready at ${uri}`); }
    } catch (e) {
      console.error(`\nCould not start the local database (${e.message}).\nSet MONGODB_URI in .env to a MongoDB Atlas connection string instead (free tier works), then run npm run dev again.\n`);
    }
  }
  // Load the app only after MONGODB_URI is final: config reads it once.
  const { createApp } = require('../server/app');
  const port = Number(process.env.API_PORT || process.env.PORT || 3001);
  const app = createApp();
  if (process.argv.includes('--serve-dist')) {
    const dist = path.join(__dirname, '..', 'dist');
    // Same security headers vercel.json sets in production.
    const vercel = require('../vercel.json');
    const headers = vercel.headers[0].headers;
    app.use((req, res, next) => { headers.forEach((h) => res.setHeader(h.key, h.value)); next(); });
    app.use(express.static(dist, { index: false }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.listen(port, () => console.log(`API listening on http://localhost:${port}${process.argv.includes('--serve-dist') ? ' (app + API)' : ' (open the app at http://localhost:5173)'}`));
})();
