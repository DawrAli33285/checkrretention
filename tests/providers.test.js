// Live provider parsing, exercised against canned API responses (no network, no keys).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PROVIDER_MODE = 'live';
process.env.PDL_API_KEY = 'test'; process.env.RAPIDAPI_KEY = 'test';
process.env.SOCIAL_MAX_PAGES = '2';
const axios = require('axios');
const recent = new Date(Date.now() - 5 * 86400000);
const old = new Date(Date.now() - 200 * 86400000);
const calls = [];

axios.get = async (url, { params } = {}) => {
  calls.push(url);
  if (url.includes('peopledatalabs')) {
    if (params.email === 'nobody@example.com') { const e = new Error('404'); e.response = { status: 404 }; throw e; }
    if (params.email === 'broke@example.com') { const e = new Error('402'); e.response = { status: 402 }; throw e; }
    return { data: { likelihood: 8, data: { linkedin_url: 'linkedin.com/in/jane-doe', facebook_url: 'facebook.com/jane.doe', twitter_url: 'twitter.com/janedoe', job_start_date: '2024-03' } } };
  }
  if (url.endsWith('/get-profile-posts')) {
    if (!params.pagination_token) return { data: { data: [
      { text: 'Feeling so underpaid this year', posted: recent.toISOString() },
      { text: 'We are hiring', reshared: true, poster_linkedin_url: 'https://linkedin.com/company/acme', posted: recent.toISOString() },
    ], paging: { pagination_token: 'p2', count: 2 } } };
    return { data: { data: [{ text: 'burned out lately', posted: old.toISOString() }], paging: {} } };
  }
  if (url.endsWith('/user')) return { data: { result: { data: { user: { result: { rest_id: '42' } } } } } };
  if (url.endsWith('/user-tweets')) return { data: { result: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
    { entryId: 'tweet-1', content: { itemContent: { tweet_results: { result: { legacy: { full_text: 'mandatory overtime again', created_at: recent.toUTCString() } } } } } },
  ] }] } } } };
  if (url.endsWith('/profile/details_url')) return { data: { profile: { profile_id: '99' } } };
  if (url.endsWith('/profile/posts')) return { data: { results: [{ message: 'Family first always', timestamp: Math.floor(recent / 1000) }] } };
  throw new Error(`unexpected ${url}`);
};

const { enrich } = require('../server/providers/enrichment');
const { collectPosts } = require('../server/providers/social');
const { scorePosts } = require('../server/scoring/signals');

test('PDL enrichment parsing, no-match and quota handling', async () => {
  const e = await enrich({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' }, true);
  assert.equal(e.matched, true);
  assert.equal(e.likelihood, 8);
  assert.equal(e.profiles.linkedin, 'https://linkedin.com/in/jane-doe');
  assert.equal(e.jobStartDate.toISOString().slice(0, 7), '2024-03');
  assert.equal((await enrich({ email: 'nobody@example.com' }, true)).matched, false);
  await assert.rejects(() => enrich({ email: 'broke@example.com' }, true), (err) => err.quota === true);
});

test('LinkedIn, X and Facebook posts are collected and scored', async () => {
  const e = await enrich({ email: 'jane@example.com' }, true);
  const { posts, errors } = await collectPosts(e, { live: true, deadline: Date.now() + 20000 });
  assert.deepEqual(errors, []);
  assert.ok(posts.find((p) => p.network === 'linkedin' && p.companyReshare));
  assert.ok(posts.find((p) => p.network === 'twitter'));
  assert.ok(posts.find((p) => p.network === 'facebook'));
  const s = scorePosts(posts);
  assert.ok(s.evidence.find((x) => x.phrase === 'underpaid'));
  assert.ok(!s.evidence.find((x) => x.phrase === 'burned out'), 'old post outside window is ignored');
  assert.ok(s.domains.financial > 1);
});
