const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['prehire', 'current'], required: true },
  fileName: { type: String, required: true },
  period: { type: String, index: true }, // YYYY-MM, for monthly limits
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'], default: 'queued', index: true },
  providerMode: { type: String, enum: ['live', 'demo'], required: true },
  modelVersion: String,
  settings: {
    enableAge: Boolean,
    lookbackDays: Number,
    jobSite: { label: String, lat: Number, lon: Number },
  },
  counts: {
    rows: { type: Number, default: 0 },       // rows in file
    scored: { type: Number, default: 0 },     // records queued for scoring (billable)
    done: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },    // not billable: no name/contact, duplicates, terminated, already run this month
  },
  cost: { type: Number, default: 0 },
  pricePerRecord: { type: Number, default: 0 },
  turnover: [{ jobClass: String, pct: Number, headcount: Number, separations: Number }],
  issues: [{ level: String, message: String }],
  lockedUntil: { type: Date, default: null },
  startedAt: Date,
  completedAt: Date,
  error: String,
  expiresAt: { type: Date, index: { expires: 0 } },
}, { timestamps: true });

module.exports = mongoose.models.Job || mongoose.model('Job', jobSchema);
