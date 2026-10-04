// Identity resolution: email/phone/name -> public social profiles.
// Live: People Data Labs Person Enrichment API. Demo: deterministic synthetic
// matches so the full pipeline can be exercised without API keys.
const axios = require('axios');
const config = require('../config');
const { seededRandom, sleep, ProviderQuotaError } = require('./util');

const PDL_URL = 'https://api.peopledatalabs.com/v5/person/enrich';

function toUrl(u) { if (!u) return null; return u.startsWith('http') ? u : `https://${u}`; }

async function enrichLive(rec, deadline = Date.now() + 45000) {
  const params = { min_likelihood: config.pdlMinLikelihood, titlecase: false };
  if (rec.email) params.email = rec.email;
  if (rec.phone) params.phone = rec.phone;
  if (rec.firstName) params.first_name = rec.firstName;
  if (rec.lastName) params.last_name = rec.lastName;
  if (rec.organization) params.company = rec.organization;
  if (rec.address) params.location = rec.address;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const timeout = Math.min(15000, Math.max(3000, deadline - Date.now()));
      const res = await axios.get(PDL_URL, { params, headers: { 'X-Api-Key': config.pdlApiKey }, timeout });
      const d = res.data?.data || {};
      return {
        source: 'live',
        matched: true,
        likelihood: res.data?.likelihood ?? null,
        profiles: { linkedin: toUrl(d.linkedin_url), facebook: toUrl(d.facebook_url), twitter: toUrl(d.twitter_url) },
        twitterUsername: d.twitter_username || null,
        jobStartDate: d.job_start_date ? new Date(`${d.job_start_date}${d.job_start_date.length === 7 ? '-01' : ''}`) : null,
        birthYear: d.birth_year || null,
      };
    } catch (e) {
      const status = e.response?.status;
      if (status === 404) return { source: 'live', matched: false, likelihood: null, profiles: {} };
      if (status === 402) throw new ProviderQuotaError('People Data Labs', 'People Data Labs credits are exhausted. Processing is paused.');
      if (status === 429 && attempt < 2 && Date.now() + 2000 * (attempt + 1) + 3000 < deadline) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`People Data Labs error${status ? ` ${status}` : ''}: ${e.response?.data?.error?.message || e.message}`);
    }
  }
  throw new Error('People Data Labs rate limit: retries exhausted');
}

function enrichDemo(rec) {
  const rnd = seededRandom(`enrich:${rec.email || rec.phone}`);
  const matched = rnd() < 0.72;
  if (!matched) return { source: 'demo', matched: false, likelihood: null, profiles: {} };
  const slug = `${(rec.firstName || 'user').toLowerCase()}-${(rec.lastName || 'demo').toLowerCase()}`.replace(/[^a-z-]/g, '') + `-${Math.floor(rnd() * 9000 + 1000)}`;
  const profiles = {
    linkedin: rnd() < 0.7 ? `https://www.linkedin.com/in/${slug}-demo` : null,
    facebook: rnd() < 0.5 ? `https://www.facebook.com/${slug}.demo` : null,
    twitter: rnd() < 0.15 ? `https://x.com/${slug.replace(/-/g, '_')}_demo` : null,
  };
  if (!profiles.linkedin && !profiles.facebook && !profiles.twitter) profiles.linkedin = `https://www.linkedin.com/in/${slug}-demo`;
  const months = Math.floor(rnd() * 72);
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - months);
  return { source: 'demo', matched: true, likelihood: 6 + Math.floor(rnd() * 5), profiles, jobStartDate: start };
}

async function enrich(rec, live, deadline) {
  return live ? enrichLive(rec, deadline) : enrichDemo(rec);
}

module.exports = { enrich, enrichDemo };
