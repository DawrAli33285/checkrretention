// Commute distance. Uses the free US Census geocoder (no key, US addresses)
// and caches results. Distance is straight-line miles to the client's job site,
// which is what the spreadsheet bands were built on. Drive time would be more
// accurate but needs a paid routing API.
const axios = require('axios');
const config = require('../config');
const GeoCache = require('../models/GeoCache');

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

function haversineMiles(a, b) {
  const R = 3958.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function geocode(address) {
  if (!address || config.geocoder === 'none') return null;
  const key = address.toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = await GeoCache.findOne({ key }).lean();
  if (hit) return hit.ok ? { lat: hit.lat, lon: hit.lon } : null;
  try {
    const res = await axios.get(CENSUS, { params: { address, benchmark: 'Public_AR_Current', format: 'json' }, timeout: 8000 });
    const m = res.data?.result?.addressMatches?.[0]?.coordinates;
    const doc = m ? { key, ok: true, lat: m.y, lon: m.x } : { key, ok: false };
    await GeoCache.updateOne({ key }, doc, { upsert: true });
    return m ? { lat: m.y, lon: m.x } : null;
  } catch {
    return null; // network problem: do not cache, try again next time
  }
}

/** @returns {{ miles:number|null, source:string }} */
async function commuteMiles(rec, jobSite) {
  if (rec.distanceMiles != null) return { miles: rec.distanceMiles, source: 'file' };
  if (!jobSite || jobSite.lat == null || jobSite.lon == null) return { miles: null, source: 'no job site set' };
  if (!rec.hasStreetAddress) return { miles: null, source: 'no address' };
  const loc = await geocode(rec.address);
  if (!loc) return { miles: null, source: 'address not found' };
  return { miles: Math.round(haversineMiles(loc, jobSite) * 10) / 10, source: 'geocoded' };
}

module.exports = { commuteMiles, haversineMiles, geocode };
