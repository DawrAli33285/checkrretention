// Optional email. If SMTP_* is not configured, messages are logged and skipped.
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
function getTransport() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendMail(to, subject, text) {
  const t = getTransport();
  if (!t || !to) { console.log(`[mail skipped] to=${to || '-'} subject="${subject}"`); return false; }
  await t.sendMail({ from: config.smtp.from, to, subject, text, html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>` });
  return true;
}

// Notify the ops inbox (NOTIFY_EMAIL) and, optionally, the client.
async function notify(subject, text, clientEmail) {
  const jobs = [];
  if (config.notifyEmail) jobs.push(sendMail(config.notifyEmail, subject, text));
  if (clientEmail) jobs.push(sendMail(clientEmail, subject, text));
  await Promise.allSettled(jobs);
}

module.exports = { sendMail, notify, mailEnabled: () => !!config.smtp.host };
