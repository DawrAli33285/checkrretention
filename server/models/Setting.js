const mongoose = require('mongoose');

// Small key/value store for app-level settings the server manages itself
// (for example the session signing key when JWT_SECRET is not provided).
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
