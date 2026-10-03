// Central configuration. Every secret and tunable comes from environment
// variables; nothing sensitive is hardcoded. See .env.example for the full list.
require('dotenv').config({ quiet: true });

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const env = process.env;

const config = {
  nodeEnv: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production' || !!env.VERCEL,

  mongoUri: env.MONGODB_URI || '',
  jwtSecret: env.JWT_SECRET || '',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',

  // First admin is created on boot if no admin exists yet.
  bootstrapAdminEmail: env.ADMIN_EMAIL || '',
  bootstrapAdminPassword: env.ADMIN_PASSWORD || '',
  allowSelfRegister: bool(env.ALLOW_SELF_REGISTER, false),
  // Optional key required on the first-run setup screen (protects a fresh deployment).
  setupToken: env.SETUP_TOKEN || '',
  // Hard cap on rows read from any file, including rows that would be skipped.
  maxRowsPerFile: num(env.MAX_ROWS_PER_FILE, 20000),

  // Billing (credits are stored in dollars).
  pricePerRecordCurrent: num(env.PRICE_PER_RECORD_CURRENT, 2.95),
  pricePerRecordPrehire: num(env.PRICE_PER_RECORD_PREHIRE, 0),
  newUserCredits: num(env.NEW_USER_CREDITS, 0),

  // Process-flow rules (Retention Process Flow Update 1-28-26).
  enforceMonthlyLimit: bool(env.ENFORCE_MONTHLY_LIMIT, true),

  // Upload limits. Vercel caps request bodies at 4.5 MB.
  maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 4 * 1024 * 1024),
  maxRecordsPerJob: num(env.MAX_RECORDS_PER_JOB, 5000),

  // Serverless-friendly processing: each /step call works for at most this long.
  stepBudgetMs: num(env.STEP_BUDGET_MS, 40000),

  // Data retention for uploaded rows, evidence and results.
  dataRetentionDays: num(env.DATA_RETENTION_DAYS, 90),

  // Providers. When the keys are missing the app runs in clearly-labelled demo mode.
  pdlApiKey: env.PDL_API_KEY || '',
  pdlMinLikelihood: num(env.PDL_MIN_LIKELIHOOD, 6), // PDL likelihood is 1-10
  rapidApiKey: env.RAPIDAPI_KEY || '',
  socialLookbackDays: num(env.SOCIAL_LOOKBACK_DAYS, 60),
  socialMaxPagesPerNetwork: num(env.SOCIAL_MAX_PAGES, 3),
  providerMode: (env.PROVIDER_MODE || 'auto').toLowerCase(), // auto | live | demo
  geocoder: (env.GEOCODER || 'census').toLowerCase(), // census | none

  // Default job site used for commute distance when a client has none set.
  defaultJobSite: {
    label: env.JOB_SITE_LABEL || '',
    lat: env.JOB_SITE_LAT ? Number(env.JOB_SITE_LAT) : null,
    lon: env.JOB_SITE_LON ? Number(env.JOB_SITE_LON) : null,
  },

  // Scoring feature flags. Age is OFF by default: see README "Compliance notes".
  enableAgeFactor: bool(env.ENABLE_AGE_FACTOR, false),

  smtp: {
    host: env.SMTP_HOST || '',
    port: num(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.SMTP_USER || '',
  },
  notifyEmail: env.NOTIFY_EMAIL || '',
  appUrl: env.APP_URL || '',
};

config.providersLive = () => {
  if (config.providerMode === 'demo') return false;
  if (config.providerMode === 'live') return true;
  return Boolean(config.pdlApiKey && config.rapidApiKey);
};

module.exports = config;
