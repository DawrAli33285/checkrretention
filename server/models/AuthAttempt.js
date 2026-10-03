const mongoose = require('mongoose');

// Failed sign-in attempts, shared by every server instance. Rows expire after 15 minutes.
const attemptSchema = new mongoose.Schema({
  key: { type: String, index: true },
  createdAt: { type: Date, default: Date.now, expires: 15 * 60 },
});

module.exports = mongoose.models.AuthAttempt || mongoose.model('AuthAttempt', attemptSchema);
