// Social listening: turns a person's recent public posts into a raw 1-10
// pressure score per domain (1 = no pressure found, 10 = heavy pressure),
// which the retention model converts to points.
//
// Rules (all documented in the README so a reviewer can audit them):
//   * Only posts inside the look-back window are considered (default 60 days).
//   * Company-page reshares are ignored.
//   * Each risk phrase adds its severity (1-3). Repeats of the same phrase
//     decay: 1st = 100%, 2nd = 50%, 3rd = 25%, each further = 10%.
//   * Each protective phrase ("paid well", "supportive manager") subtracts 1.
//   * raw = clamp(1 + round(pressure * SIGNAL_STEP), 1, 10)
//   * No posts at all                       -> null (no signal, 0 points)
//   * Fewer than MIN_POSTS posts and no hit -> null (not enough evidence)
// Full post text is never stored: only which phrases matched and how often.

const library = require('./keywords.json');

const SIGNAL_STEP = Number(process.env.SIGNAL_STEP || 1);
const MIN_POSTS = Number(process.env.SIGNAL_MIN_POSTS || 3);

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Precompile once at load: [{domain, phrase, re, polarity, severity}]
const MATCHERS = [];
for (const [domain, phrases] of Object.entries(library.domains)) {
  for (const [phrase, meta] of Object.entries(phrases)) {
    const norm = normalizeText(phrase);
    if (!norm) continue;
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    MATCHERS.push({ domain, phrase, re: new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'g'), polarity: meta.polarity, severity: meta.severity });
  }
}

function decayedWeight(count) {
  const steps = [1, 0.5, 0.25];
  let total = 0;
  for (let i = 0; i < count; i++) total += i < steps.length ? steps[i] : 0.1;
  return total;
}

/**
 * @param {Array<{text:string, network?:string, date?:string|Date, companyReshare?:boolean}>} posts
 * @param {{ lookbackDays?: number, now?: Date }} opts
 * @returns {{ postsConsidered:number, domains:Object<string,number|null>, evidence:Array }}
 */
function scorePosts(posts, opts = {}) {
  const now = opts.now || new Date();
  const lookbackDays = opts.lookbackDays || 60;
  const cutoff = new Date(now.getTime() - lookbackDays * 86400000);

  const usable = (posts || []).filter((p) => {
    if (!p || !p.text || p.companyReshare) return false;
    if (p.date) {
      const d = new Date(p.date);
      if (!Number.isNaN(d.getTime()) && d < cutoff) return false;
    }
    return true;
  });

  const counts = {}; // `${domain}|${phrase}` -> {count, networks:Set}
  for (const post of usable) {
    const text = normalizeText(post.text);
    if (!text) continue;
    for (const m of MATCHERS) {
      m.re.lastIndex = 0;
      const hits = text.match(m.re);
      if (hits && hits.length) {
        const k = `${m.domain}|${m.phrase}`;
        if (!counts[k]) counts[k] = { m, count: 0, networks: new Set() };
        counts[k].count += hits.length;
        if (post.network) counts[k].networks.add(post.network);
      }
    }
  }

  const pressure = {};
  const hitsByDomain = {};
  const evidence = [];
  for (const { m, count, networks } of Object.values(counts)) {
    const w = decayedWeight(count);
    pressure[m.domain] = (pressure[m.domain] || 0) + (m.polarity === 'protective' ? -w : w * m.severity);
    hitsByDomain[m.domain] = (hitsByDomain[m.domain] || 0) + 1;
    evidence.push({ domain: m.domain, phrase: m.phrase, polarity: m.polarity, count, networks: [...networks] });
  }

  const domains = {};
  for (const domain of Object.keys(library.domains)) {
    if (usable.length === 0) { domains[domain] = null; continue; }
    if (!hitsByDomain[domain] && usable.length < MIN_POSTS) { domains[domain] = null; continue; }
    const p = Math.max(0, pressure[domain] || 0);
    domains[domain] = Math.min(10, Math.max(1, 1 + Math.round(p * SIGNAL_STEP)));
  }

  evidence.sort((a, b) => b.count - a.count);
  return { postsConsidered: usable.length, domains, evidence };
}

module.exports = { scorePosts, normalizeText, MATCHERS, library, decayedWeight };
