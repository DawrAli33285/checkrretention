// Input cleaning. Client files arrive in many shapes (Hancock alone used
// "Department" and "Department Name", 2-digit years, 5 phone formats, ZIPs as
// floats, trailing spaces in headers). Everything is mapped to one canonical
// record here so the rest of the app never touches raw column names.

const HEADER_ALIASES = {
  employeeNumber: ['employee number', 'employee id', 'employee #', 'emp id', 'candidate id', 'id'],
  name: ['employee name (last suffix, first mi)', 'employee name (last suffix,first mi)', 'employee name', 'candidate (last, suffix first mi)', 'candidate name', 'candidate', 'name', 'full name'],
  firstName: ['first name', 'first'],
  lastName: ['last name', 'last'],
  email: ['e-mail address', 'email address', 'email', 'work email', 'e-mail'],
  altEmail: ['alternate email', 'personal email', 'alt email'],
  phone: ['home phone (formatted)', 'primary phone', 'phone', 'mobile phone', 'mobile', 'cell phone', 'home phone'],
  address1: ['address line 1 + address line 2', 'address 1', 'address line 1', 'address', 'street address'],
  city: ['city'],
  state: ['state/province code', 'state', 'state code'],
  zip: ['zip/postal code', 'zip', 'zip code', 'postal code'],
  cityStateZip: ['city, state zip code (formatted)', 'city state zip', 'city, state zip'],
  hireDate: ['hire date', 'last hire date', 'job hire date', 'original hire', 'seniority date', 'job start'],
  termDate: ['term date', 'termination date'],
  termReason: ['termination reason', 'term reason'],
  employmentStatus: ['employment status', 'status'],
  organization: ['organization', 'org', 'entity', 'company'],
  division: ['division'],
  department: ['department', 'department name', 'dept'],
  jobClass: ['job class', 'job title', 'title', 'source job', 'opportunity title', 'position'],
  jobCode: ['job code', 'source job code'],
  dateOfBirth: ['date of birth', 'dob', 'birth date'],
  salaryRange: ['salary range', 'salary range / hourly rate', 'hourly rate'],
  payGrade: ['pay grade'],
  employeeLevel: ['employee level'],
  distanceMiles: ['distance (miles)', 'distance', 'commute miles'],
  turnoverPct: ['turnover %', 'department turnover %', 'job class turnover %'],
  // Optional pre-computed domain scores (1-10). Used only when supplied, and labelled "client-provided".
  providedFinancial: ['finance score (1-10)', 'financial score (1-10)'],
  providedSchedule: ['schedule score (1-10)'],
  providedWorkLife: ['work life balance score (1-10)', 'work-life balance score (1-10)'],
  providedCommunication: ['communication score (1-10)', 'family score (1-10)'],
  // Optional financial inputs for the Financial Impact view.
  replacementCost: ['replacement cost'],
  vacancyDays: ['vacancy days'],
  dailyLoadedLaborCost: ['daily loaded labor cost'],
  overtimeCost: ['overtime cost', 'overtime or contract cost'],
  productivityDisruptionCost: ['productivity disruption cost'],
  annualSalary: ['annual salary', 'salary'],
};

const normHeader = (h) => String(h ?? '').replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase();

function buildHeaderMap(headers) {
  const byNorm = new Map();
  headers.forEach((h) => { const n = normHeader(h); if (n && !byNorm.has(n)) byNorm.set(n, h); });
  // field -> every matching column, best alias first. Rows fall back to the
  // next column when the first is blank (pre-hire "Source Job" is ~95% empty,
  // "Opportunity Title" is filled).
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const cols = aliases.filter((a) => byNorm.has(a)).map((a) => byNorm.get(a));
    if (cols.length) map[field] = cols;
  }
  return map;
}

const clean = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v.text) return String(v.text).trim(); // exceljs rich text / hyperlink
  if (typeof v === 'object' && v.result !== undefined) return clean(v.result); // exceljs formula
  const s = String(v).trim();
  return ['n/a', 'na', 'null', 'undefined', '-'].includes(s.toLowerCase()) ? '' : s;
};

function normalizeEmail(v) {
  const s = String(clean(v)).toLowerCase().replace(/^mailto:/, '').trim();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : '';
}

// Returns E.164-ish US format +1XXXXXXXXXX, or '' when not a plausible number.
function normalizePhone(v) {
  const digits = String(clean(v)).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function normalizeZip(v) {
  if (v === '' || v === null || v === undefined) return '';
  let s = String(clean(v));
  if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
  const m = s.match(/^(\d{3,5})(?:-?(\d{4}))?$/);
  if (!m) return s;
  return m[1].padStart(5, '0');
}

// Real calendar dates only: 2020-13-45 or 2/30/2021 are rejected, not rolled forward.
function validDate(y, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || y < 1900 || y > 2100) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
}

// Excel serial (days since 1899-12-30), Date objects, ISO, M/D/YY, M/D/YYYY (optionally with a time).
// Two-digit years pivot on the current year: 70 -> 1970, 23 -> 2023.
function parseDate(v, now = new Date()) {
  const raw = clean(v);
  if (raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  }
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s|$)/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y > now.getUTCFullYear() % 100 ? 1900 : 2000;
    return validDate(y, +m[1], +m[2]);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthsBetween(from, to = new Date()) {
  if (!from) return null;
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0);
  return months < 0 ? null : months;
}

function yearsBetween(from, to = new Date()) {
  const m = monthsBetween(from, to);
  return m === null ? null : Math.floor(m / 12);
}

// "Staff Nurse RN - R6025" -> "Staff Nurse RN" (Hancock appends location codes to titles).
function normalizeJobClass(v) {
  return String(clean(v)).replace(/\s*-\s*R\d{3,}\s*$/i, '').replace(/\s+/g, ' ').trim();
}

// "Abernathy, Rita K." -> { first: 'Rita', last: 'Abernathy', display: 'Abernathy, Rita K.' }
function splitName(full, first, last) {
  const f = String(clean(first)); const l = String(clean(last));
  if (f || l) return { first: f, last: l, display: [l, f].filter(Boolean).join(', ') };
  const s = String(clean(full)).replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '', display: '' };
  if (s.includes(',')) {
    const [lastPart, rest = ''] = s.split(',');
    const firstPart = rest.trim().split(' ')[0] || '';
    return { first: titleCase(firstPart), last: titleCase(lastPart.trim()), display: s };
  }
  const parts = s.split(' ');
  return { first: titleCase(parts[0]), last: titleCase(parts.slice(1).join(' ')), display: s };
}

function titleCase(s) {
  if (!s || s !== s.toLowerCase()) return s;
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const num = (v) => {
  const s = String(clean(v)).replace(/[$,%\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function isTerminated(rec) {
  const status = (rec.employmentStatus || '').toLowerCase();
  if (status.includes('term') || status.includes('inactive')) return true;
  return !!rec.termDate && rec.termDate <= new Date();
}

/** Map one raw row to the canonical record. */
function normalizeRow(row, headerMap) {
  const get = (f) => {
    for (const col of headerMap[f] || []) {
      const v = row[col];
      if (clean(v) !== '') return v;
    }
    return '';
  };
  const name = splitName(get('name'), get('firstName'), get('lastName'));
  const email = normalizeEmail(get('email'));
  const altEmail = normalizeEmail(get('altEmail'));
  const cityStateZip = String(clean(get('cityStateZip')));
  const city = String(clean(get('city')));
  const state = String(clean(get('state'))).toUpperCase();
  const zip = normalizeZip(get('zip'));
  const addressLine = String(clean(get('address1')));
  const fullAddress = [addressLine, cityStateZip || [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
    .filter(Boolean).join(', ');

  const provided = {};
  for (const [k, f] of [['financial', 'providedFinancial'], ['schedule', 'providedSchedule'], ['workLife', 'providedWorkLife'], ['communication', 'providedCommunication']]) {
    const n = num(get(f));
    if (n !== null && n >= 1 && n <= 10) provided[k] = Math.round(n);
  }

  const turnover = num(get('turnoverPct'));
  const rec = {
    employeeNumber: String(clean(get('employeeNumber'))),
    name: name.display,
    firstName: name.first,
    lastName: name.last,
    email: email || altEmail,
    altEmail: email ? altEmail : '',
    phone: normalizePhone(get('phone')),
    address: fullAddress,
    hasStreetAddress: !!addressLine,
    hireDate: parseDate(get('hireDate')),
    termDate: parseDate(get('termDate')),
    termReason: String(clean(get('termReason'))),
    employmentStatus: String(clean(get('employmentStatus'))),
    organization: String(clean(get('organization'))),
    division: String(clean(get('division'))),
    department: String(clean(get('department'))),
    jobClass: normalizeJobClass(get('jobClass')),
    jobClassRaw: String(clean(get('jobClass'))),
    jobCode: String(clean(get('jobCode'))),
    dateOfBirth: parseDate(get('dateOfBirth')),
    salaryRange: String(clean(get('salaryRange'))),
    distanceMiles: num(get('distanceMiles')),
    // Accept 0.35 or 35 for 35%.
    turnoverPct: turnover === null ? null : turnover <= 1 ? Math.round(turnover * 1000) / 10 : turnover,
    providedDomains: Object.keys(provided).length ? provided : null,
    financials: {
      replacementCost: num(get('replacementCost')),
      vacancyDays: num(get('vacancyDays')),
      dailyLoadedLaborCost: num(get('dailyLoadedLaborCost')),
      overtimeOrContractCost: num(get('overtimeCost')),
      productivityDisruptionCost: num(get('productivityDisruptionCost')),
      annualSalary: num(get('annualSalary')),
    },
  };
  rec.terminated = isTerminated(rec);
  return rec;
}

const contactKey = (rec) => rec.email || rec.phone || '';

module.exports = {
  HEADER_ALIASES,
  buildHeaderMap,
  normalizeRow,
  normalizeEmail,
  normalizePhone,
  normalizeZip,
  normalizeJobClass,
  parseDate,
  monthsBetween,
  yearsBetween,
  splitName,
  contactKey,
  clean,
};
