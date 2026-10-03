// Public post collection for the social listening step.
// Live: RapidAPI scrapers (LinkedIn, X/Twitter, Facebook), ported from the
// original backend with the following fixes:
//   * 429 retries now actually wait (the old loop computed a wait time but never slept)
//   * page caps per network so one person cannot consume the whole time budget
//   * every request has a timeout; errors are collected, not swallowed
//   * returns the same shape on every path ({ posts, errors })
// Demo: deterministic synthetic posts, clearly labelled as demo data.
const axios = require('axios');
const config = require('../config');
const { library } = require('../scoring/signals');
const { sleep, seededRandom } = require('./util');

const DAY = 86400000;

async function rapidGet(host, path, params, deadline) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await axios.get(`https://${host}${path}`, {
        params,
        timeout: 15000,
        headers: { 'x-rapidapi-key': config.rapidApiKey, 'x-rapidapi-host': host },
      });
      return res.data;
    } catch (e) {
      const status = e.response?.status;
      const wait = Math.min(2000 * 2 ** attempt, 15000);
      if (status === 429 && Date.now() + wait < deadline) { await sleep(wait); continue; }
      const err = new Error(`${host} ${status || ''} ${e.message}`.trim());
      err.status = status;
      throw err;
    }
  }
  throw new Error(`${host}: rate limited, retries exhausted`);
}

async function linkedinPosts(url, cutoff, deadline) {
  const host = 'fresh-linkedin-profile-data.p.rapidapi.com';
  const out = [];
  let start = 0; let token = null;
  for (let page = 0; page < config.socialMaxPagesPerNetwork && Date.now() < deadline; page++) {
    const params = { linkedin_url: url, type: 'posts', start };
    if (token) params.pagination_token = token;
    const data = await rapidGet(host, '/get-profile-posts', params, deadline);
    const items = data?.data || [];
    if (!items.length) break;
    let oldest = null;
    for (const p of items) {
      const date = p.reshared && p.reposted ? new Date(p.reposted) : p.posted ? new Date(p.posted) : null;
      if (date && (!oldest || date < oldest)) oldest = date;
      const text = [p.resharer_comment, p.text || p.resharedPost?.text].filter(Boolean).join(' \n ');
      if (!text) continue;
      const companyReshare = !!p.reshared && String(p.poster_linkedin_url || '').includes('/company/');
      out.push({ text, network: 'linkedin', date, companyReshare });
    }
    if (oldest && oldest < cutoff) break;
    const paging = data?.paging;
    if (!paging?.pagination_token) break;
    token = paging.pagination_token; start += paging.count || items.length;
  }
  return out;
}

async function twitterPosts(username, cutoff, deadline) {
  const host = 'twitter241.p.rapidapi.com';
  const user = await rapidGet(host, '/user', { username }, deadline);
  const userId = user?.result?.data?.user?.result?.rest_id;
  if (!userId) return [];
  const out = []; const seen = new Set();
  let cursor = null;
  for (let page = 0; page < config.socialMaxPagesPerNetwork && Date.now() < deadline; page++) {
    const params = { user: userId, count: '20' };
    if (cursor) params.cursor = cursor;
    const data = await rapidGet(host, '/user-tweets', params, deadline);
    const instructions = data?.result?.timeline?.instructions || [];
    const entries = instructions.find((i) => i.type === 'TimelineAddEntries')?.entries || [];
    const legacies = [];
    for (const e of entries) {
      if (e.entryId?.startsWith('tweet-')) legacies.push(e.content?.itemContent?.tweet_results?.result?.legacy);
      else if (Array.isArray(e.content?.items)) e.content.items.forEach((it) => legacies.push(it.item?.itemContent?.tweet_results?.result?.legacy));
    }
    let oldest = null; let added = 0;
    for (const l of legacies) {
      if (!l?.full_text || seen.has(l.full_text)) continue;
      seen.add(l.full_text); added++;
      const date = l.created_at ? new Date(l.created_at) : null;
      if (date && (!oldest || date < oldest)) oldest = date;
      out.push({ text: l.full_text, network: 'twitter', date });
    }
    const next = entries.find((e) => e.entryId?.startsWith('cursor-bottom'))?.content?.value || data?.result?.cursor?.bottom || null;
    if (!added || !next || next === cursor || (oldest && oldest < cutoff)) break;
    cursor = next;
  }
  return out;
}

async function facebookPosts(url, cutoff, deadline) {
  const host = 'facebook-scraper3.p.rapidapi.com';
  const details = await rapidGet(host, '/profile/details_url', { url }, deadline);
  const profileId = details?.profile?.profile_id;
  if (!profileId) return [];
  const fmt = (d) => d.toISOString().slice(0, 10);
  const out = []; const seen = new Set();
  let cursor = null;
  for (let page = 0; page < config.socialMaxPagesPerNetwork && Date.now() < deadline; page++) {
    const params = { profile_id: profileId, start_date: fmt(cutoff), end_date: fmt(new Date()) };
    if (cursor) params.cursor = cursor;
    const data = await rapidGet(host, '/profile/posts', params, deadline);
    const results = data?.results || [];
    if (!results.length) break;
    for (const p of results) {
      if (!p.message || seen.has(p.message)) continue;
      seen.add(p.message);
      const date = p.timestamp ? new Date(p.timestamp * 1000) : p.creation_time ? new Date(p.creation_time * 1000) : null;
      out.push({ text: p.message, network: 'facebook', date });
    }
    cursor = data?.cursor || null;
    if (!cursor) break;
  }
  return out;
}

function twitterHandle(url, username) {
  if (username) return username;
  const m = String(url || '').match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

async function collectLive(enrichment, { deadline }) {
  const cutoff = new Date(Date.now() - config.socialLookbackDays * DAY);
  const posts = []; const errors = [];
  const tasks = [];
  const p = enrichment.profiles || {};
  if (p.linkedin) tasks.push(['linkedin', () => linkedinPosts(p.linkedin, cutoff, deadline)]);
  const handle = twitterHandle(p.twitter, enrichment.twitterUsername);
  if (handle) tasks.push(['twitter', () => twitterPosts(handle, cutoff, deadline)]);
  if (p.facebook) tasks.push(['facebook', () => facebookPosts(p.facebook, cutoff, deadline)]);
  const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') posts.push(...r.value);
    else errors.push(`${tasks[i][0]}: ${r.reason?.message || r.reason}`);
  });
  return { posts, errors };
}

// ---------------------------------------------------------------- demo mode
const NEUTRAL_POSTS = [
  'Great weekend at the lake with the family.',
  'Congrats to our team on the new unit opening!',
  'Anyone have a good chili recipe? Asking for a friend.',
  'Proud of my daughter for finishing her first 5K today.',
  'Throwback to last summer. Cannot wait for vacation.',
  'Happy birthday to my amazing sister!',
  'Finished another CE course this week. Always learning.',
  'Coffee first, then the world.',
  'Beautiful sunrise on the drive in this morning.',
  'Go Colts! What a game.',
  'Volunteered at the food pantry today. Highly recommend it.',
  'New puppy has entered the chat.',
];

function phrasePool(polarity) {
  const pool = [];
  for (const [domain, phrases] of Object.entries(library.domains)) {
    for (const [phrase, meta] of Object.entries(phrases)) if (meta.polarity === polarity || (polarity === 'risk' && !meta.polarity)) pool.push({ domain, phrase });
  }
  return pool;
}
const RISK_POOL = phrasePool('risk');
const PROTECTIVE_POOL = phrasePool('protective');

function collectDemo(enrichment, seedKey) {
  const rnd = seededRandom(`posts:${seedKey}`);
  if (!enrichment.matched || rnd() < 0.2) return { posts: [], errors: [] };
  const nPosts = 2 + Math.floor(rnd() * 12);
  const persona = rnd(); // <0.35 calm, <0.75 mixed, else strained
  const riskCount = persona < 0.35 ? Math.floor(rnd() * 2) : persona < 0.75 ? 1 + Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 6);
  const focus = RISK_POOL.filter((p) => p.domain === ['financial', 'schedule', 'workLife', 'communication', 'jobSatisfaction'][Math.floor(rnd() * 5)]);
  const posts = [];
  const now = Date.now();
  const net = () => (enrichment.profiles.linkedin && rnd() < 0.6 ? 'linkedin' : enrichment.profiles.facebook ? 'facebook' : 'linkedin');
  const date = () => new Date(now - Math.floor(rnd() * 55) * DAY);
  for (let i = 0; i < nPosts; i++) posts.push({ text: NEUTRAL_POSTS[Math.floor(rnd() * NEUTRAL_POSTS.length)], network: net(), date: date() });
  for (let i = 0; i < riskCount; i++) {
    const pool = persona >= 0.75 && rnd() < 0.7 && focus.length ? focus : RISK_POOL;
    const { phrase } = pool[Math.floor(rnd() * pool.length)];
    posts.push({ text: `Honestly... ${phrase}. Some weeks are harder than others.`, network: net(), date: date() });
  }
  if (persona < 0.5 && rnd() < 0.6 && PROTECTIVE_POOL.length) {
    const { phrase } = PROTECTIVE_POOL[Math.floor(rnd() * PROTECTIVE_POOL.length)];
    posts.push({ text: `Grateful for ${phrase} at my job.`, network: net(), date: date() });
  }
  return { posts, errors: [] };
}

async function collectPosts(enrichment, { live, deadline, seedKey }) {
  if (!enrichment?.matched) return { posts: [], errors: [] };
  return live ? collectLive(enrichment, { deadline }) : collectDemo(enrichment, seedKey);
}

module.exports = { collectPosts, collectDemo, twitterHandle };
