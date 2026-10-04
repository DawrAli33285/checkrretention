const mongoose = require('mongoose');

const geoSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  ok: Boolean,
  lat: Number,
  lon: Number,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
});

module.exports = mongoose.models.GeoCache || mongoose.model('GeoCache', geoSchema);
