const mongoose = require('mongoose');

// One row of an uploaded file and, once processed, its result.
// Raw post text is never stored; only which phrases matched.
const recordSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rowIndex: Number,
  contactKey: { type: String, index: true },
  period: { type: String, index: true },
  jobType: String,
  status: { type: String, enum: ['pending', 'processing', 'done', 'error', 'skipped'], default: 'pending', index: true },
  skipReason: String,
  input: { type: mongoose.Schema.Types.Mixed },
  enrichment: {
    source: String, // live | demo | none
    matched: Boolean,
    likelihood: Number,
    profiles: { linkedin: String, facebook: String, twitter: String },
    jobStartDate: Date,
  },
  social: {
    source: String, // social | demo | provided | none
    postsConsidered: Number,
    domains: { type: mongoose.Schema.Types.Mixed },
    insight: { type: mongoose.Schema.Types.Mixed },
    evidence: [{ domain: String, phrase: String, polarity: String, count: Number, networks: [String] }],
    providerErrors: [String],
  },
  factors: {
    ageYears: Number,
    distanceMiles: Number,
    distanceSource: String,
    tenureMonths: Number,
    tenureSource: String,
    turnoverPct: Number,
    turnoverSource: String,
  },
  score: { type: mongoose.Schema.Types.Mixed },
  flags: [String],
  error: String,
  processedAt: Date,
  expiresAt: { type: Date, index: { expires: 0 } },
}, { timestamps: true });

recordSchema.index({ job: 1, status: 1, rowIndex: 1 });
recordSchema.index({ user: 1, jobType: 1, period: 1, contactKey: 1 });

module.exports = mongoose.models.Record || mongoose.model('Record', recordSchema);
