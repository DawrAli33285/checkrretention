// Vercel serverless entry. vercel.json rewrites every /api/* request here.
const { createApp } = require('../server/app');

module.exports = createApp();
