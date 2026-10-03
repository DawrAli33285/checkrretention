// One-time import of client accounts and credit balances from the old app's
// database into the new one. Passwords are NOT copied (the old app stored them
// in plain text and its database credentials were published in source code).
// Every imported user gets a random temporary password, printed once below.
//
//   LEGACY_MONGODB_URI="mongodb+srv://..." MONGODB_URI="mongodb+srv://..." node scripts/migrate-legacy.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

(async () => {
  const legacyUri = process.env.LEGACY_MONGODB_URI; const newUri = process.env.MONGODB_URI;
  if (!legacyUri || !newUri || legacyUri === newUri) throw new Error('Set LEGACY_MONGODB_URI and MONGODB_URI to two different databases.');
  const legacy = await mongoose.createConnection(legacyUri).asPromise();
  const target = await mongoose.createConnection(newUri).asPromise();
  const oldUsers = await legacy.db.collection('users').find({}, { projection: { email: 1, credits: 1 } }).toArray();
  const users = target.db.collection('users');
  const rows = [];
  for (const u of oldUsers) {
    const email = String(u.email || '').toLowerCase().trim();
    if (!email || (await users.findOne({ email }))) continue;
    const temp = crypto.randomBytes(9).toString('base64url');
    await users.insertOne({ email, name: '', organization: '', role: 'client', active: true, credits: Math.max(0, Number(u.credits) || 0), passwordHash: await bcrypt.hash(temp, 12), turnoverTable: [], jobSite: { label: '', address: '', lat: null, lon: null }, createdAt: new Date(), updatedAt: new Date() });
    rows.push({ email, credits: u.credits || 0, temporaryPassword: temp });
  }
  console.table(rows);
  console.log(`Imported ${rows.length} of ${oldUsers.length} legacy users. Send each person their temporary password securely and ask them to change it under Account.`);
  await legacy.close(); await target.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
