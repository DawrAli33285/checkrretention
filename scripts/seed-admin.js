// Create or reset an admin account: npm run seed:admin -- email@example.com "a-long-password"
const bcrypt = require('bcryptjs');
const { connectDb, disconnectDb } = require('../server/db');
const User = require('../server/models/User');

(async () => {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run seed:admin -- <email> <password>');
    process.exit(1);
  }
  if (password.length < 8) console.warn('Warning: this password is short. Use it for testing only and change it under Account afterwards.');
  await connectDb();
  const passwordHash = await bcrypt.hash(password, 12);
  await User.updateOne({ email: email.toLowerCase() }, { $set: { passwordHash, role: 'admin', active: true }, $setOnInsert: { name: 'Administrator', credits: 0 }, $inc: { sessionVersion: 1 } }, { upsert: true });
  console.log(`Admin ready: ${email}`);
  await disconnectDb();
})().catch((e) => { console.error(e.message); process.exit(1); });
