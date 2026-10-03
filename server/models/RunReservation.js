const mongoose = require('mongoose');

// One row per current-staff run a client starts in a month. The unique index
// is the lock: two uploads racing for the same slot cannot both insert it.
// Rows are never removed when a run is deleted, so the monthly limit holds.
const reservationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  period: { type: String, required: true }, // YYYY-MM
  slot: { type: Number, required: true }, // 0 = the included run, 1+ = extra runs granted by an admin
}, { timestamps: true });
reservationSchema.index({ user: 1, period: 1, slot: 1 }, { unique: true });

module.exports = mongoose.models.RunReservation || mongoose.model('RunReservation', reservationSchema);
