const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: '' },
  organization: { type: String, default: '' },
  role: { type: String, enum: ['client', 'admin'], default: 'client' },
  active: { type: Boolean, default: true },
  credits: { type: Number, default: 0, min: 0 }, // dollars
  // Commute distance is measured to this site. Admin sets it per client.
  jobSite: {
    label: { type: String, default: '' },
    address: { type: String, default: '' },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
  },
  // Annual turnover % by job class. Refreshed from each current-staff upload
  // (when the file includes terminations) and reused for pre-hire scoring.
  turnoverTable: [{ jobClass: String, pct: Number, headcount: Number, separations: Number, updatedAt: Date }],
  // Extra current-staff runs an admin granted for a month: { period: '2026-09', count: 1 }.
  extraRuns: { period: { type: String, default: '' }, count: { type: Number, default: 0 } },
  // Bumped on password change, reset or disable: every older session stops working.
  sessionVersion: { type: Number, default: 0 },
  resetTokenHash: { type: String, default: null },
  resetExpires: { type: Date, default: null },
  lastLoginAt: Date,
}, { timestamps: true });

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const o = this.toObject();
  delete o.passwordHash; delete o.resetTokenHash; delete o.resetExpires; delete o.__v;
  return o;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
