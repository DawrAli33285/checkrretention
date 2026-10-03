// File intake: parse CSV/XLSX, map columns, validate, de-duplicate and
// compute job-class turnover. Pure functions (no DB) so they are easy to test.
const Papa = require('papaparse');
const ExcelJS = require('exceljs');
const { buildHeaderMap, normalizeRow, contactKey, monthsBetween } = require('./normalize');

class IntakeError extends Error {
  constructor(message, details) { super(message); this.status = 400; this.details = details; }
}

function decodeText(buffer) {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}

async function parseFile(buffer, fileName, { maxRows = 20000 } = {}) {
  const tooMany = () => new IntakeError(`This file has more than ${maxRows.toLocaleString('en-US')} rows. Split it into smaller files.`);
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') {
    // preview stops parsing just past the cap, so an oversized file cannot exhaust memory.
    const parsed = Papa.parse(decodeText(buffer), { header: true, skipEmptyLines: 'greedy', preview: maxRows + 1, transformHeader: (h) => h.trim() });
    if (parsed.data.length > maxRows) throw tooMany();
    const headers = (parsed.meta.fields || []).filter(Boolean);
    return { headers, rows: parsed.data };
  }
  if (ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch (e) { throw new IntakeError('This Excel file could not be read. Re-save it as .xlsx or .csv and try again.'); }
    const ws = wb.worksheets.find((w) => w.actualRowCount > 1) || wb.worksheets[0];
    if (!ws) throw new IntakeError('The workbook has no worksheets.');
    let headerRow = null;
    ws.eachRow((row, n) => { if (!headerRow && row.cellCount > 1) headerRow = n; });
    if (!headerRow) return { headers: [], rows: [] };
    const headers = [];
    ws.getRow(headerRow).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = String(cell.text || '').trim(); });
    const rows = [];
    if (ws.actualRowCount - headerRow > maxRows) throw tooMany();
    ws.eachRow((row, n) => {
      if (n <= headerRow) return;
      const obj = {}; let any = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const h = headers[col]; if (!h) return;
        let v = cell.value;
        if (v && typeof v === 'object' && !(v instanceof Date)) v = cell.text;
        obj[h] = v; if (v !== null && v !== '') any = true;
      });
      if (any) rows.push(obj);
    });
    return { headers: headers.filter(Boolean), rows };
  }
  if (ext === 'xls') throw new IntakeError('Old .xls files are not supported. Open the file in Excel and save it as .xlsx or .csv.');
  throw new IntakeError('Unsupported file type. Upload a .csv or .xlsx file.');
}

const REQUIRED = {
  // Retention Process Flow (1-28-26): name, phone, email, address, hire date, org, division, department, job class.
  current: {
    columns: [['name', 'Employee Name'], ['email|phone', 'E-mail Address or Phone'], ['hireDate', 'Hire Date'], ['jobClass', 'Job Class'], ['department', 'Department']],
    recommended: [['address1', 'Address Line 1'], ['organization', 'Organization'], ['division', 'Division'], ['phone', 'Phone'], ['email', 'E-mail Address']],
  },
  prehire: {
    columns: [['name', 'Candidate (Last, Suffix First MI)'], ['email', 'Email Address']],
    recommended: [['address1', 'Address 1'], ['zip', 'Zip/Postal Code'], ['jobClass', 'Opportunity Title or Source Job'], ['phone', 'Primary Phone']],
  },
};

// Separations that are not attrition (temp contract ends, internal moves).
const NON_ATTRITION = /(temp|transfer|deceased|death|reorganization|position eliminated)/i;

/**
 * Annual turnover by job class from a staff file that includes terminations.
 * turnover % = separations in the last 12 months / average headcount,
 * average headcount ~= active + separations/2. Groups under 5 people use the
 * organisation-wide rate. Returns [] when the file has no terminations.
 */
function computeTurnover(records, now = new Date()) {
  const yearAgo = new Date(now.getTime() - 365 * 86400000);
  const groups = new Map();
  let anySeparations = false;
  for (const r of records) {
    const key = r.jobClass || '(unspecified)';
    if (!groups.has(key)) groups.set(key, { active: 0, separations: 0 });
    const g = groups.get(key);
    if (r.terminated) {
      if (r.termDate && r.termDate >= yearAgo && !NON_ATTRITION.test(r.termReason || '')) { g.separations++; anySeparations = true; }
    } else {
      g.active++;
    }
  }
  if (!anySeparations) return [];
  let totA = 0; let totS = 0;
  for (const g of groups.values()) { totA += g.active; totS += g.separations; }
  const orgPct = totA + totS / 2 > 0 ? (totS / (totA + totS / 2)) * 100 : null;
  const out = [];
  for (const [jobClass, g] of groups) {
    if (jobClass === '(unspecified)') continue;
    const avgHead = g.active + g.separations / 2;
    const pct = avgHead >= 5 ? (g.separations / avgHead) * 100 : orgPct;
    if (pct === null) continue;
    out.push({ jobClass, pct: Math.round(pct * 10) / 10, headcount: g.active, separations: g.separations, usedOrgRate: avgHead < 5 });
  }
  return out.sort((a, b) => b.headcount - a.headcount);
}

/**
 * @param {'current'|'prehire'} type
 * @returns {{ headerMap, records:[{rowIndex, rec, contactKey, skipReason?}], issues, stats, turnover }}
 */
function buildIntake(type, headers, rows, opts = {}) {
  const spec = REQUIRED[type];
  if (!spec) throw new IntakeError('Unknown upload type.');
  if (!rows.length) throw new IntakeError('The file has no data rows.');
  const headerMap = buildHeaderMap(headers);
  const has = (f) => f.split('|').some((x) => headerMap[x]);
  const missing = spec.columns.filter(([f]) => !has(f)).map(([, label]) => label);
  if (missing.length) {
    throw new IntakeError(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, { missing, found: headers });
  }
  const issues = [];
  const missingRec = spec.recommended.filter(([f]) => !has(f)).map(([, label]) => label);
  if (missingRec.length) issues.push({ level: 'warning', message: `Recommended column(s) not found: ${missingRec.join(', ')}. Scores will run with less data.` });
  if (type === 'prehire' && headerMap.dateOfBirth) issues.push({ level: 'warning', message: 'Date of birth was supplied for candidates. It is ignored for pre-hire scoring.' });

  const maxRecords = opts.maxRecords || 5000;
  const seen = new Set();
  const previouslyRun = opts.previouslyRunContacts || new Set();
  const records = [];
  const counts = { noName: 0, noContact: 0, duplicate: 0, terminated: 0, alreadyRun: 0 };
  const all = [];

  rows.forEach((row, i) => {
    const rec = normalizeRow(row, headerMap);
    const rowIndex = i + 2; // spreadsheet row number (header is row 1)
    all.push(rec);
    const key = contactKey(rec);
    let skipReason = null;
    if (!rec.name) { skipReason = 'Missing name'; counts.noName++; }
    else if (!key) { skipReason = 'No valid email or phone'; counts.noContact++; }
    else if (type === 'current' && rec.terminated) { skipReason = 'Terminated employee (used for turnover only)'; counts.terminated++; }
    else if (seen.has(key)) { skipReason = 'Duplicate contact in this file'; counts.duplicate++; }
    else if (previouslyRun.has(key)) { skipReason = 'Already processed this month'; counts.alreadyRun++; }
    if (key && !skipReason) seen.add(key);
    records.push({ rowIndex, rec, contactKey: key, skipReason });
  });

  const billable = records.filter((r) => !r.skipReason).length;
  if (billable > maxRecords) throw new IntakeError(`This file has ${billable} scorable records. The limit per upload is ${maxRecords}. Split the file and upload in parts.`);
  if (billable === 0) throw new IntakeError('No scorable records found. Check that rows have a name and a valid email or phone.', { counts });

  if (counts.duplicate) issues.push({ level: 'info', message: `${counts.duplicate} duplicate contact(s) in the file were merged (same email/phone). They are not charged.` });
  if (counts.noContact) issues.push({ level: 'warning', message: `${counts.noContact} row(s) have no valid email or phone and were skipped.` });
  if (counts.noName) issues.push({ level: 'warning', message: `${counts.noName} row(s) have no name and were skipped.` });
  if (counts.terminated) issues.push({ level: 'info', message: `${counts.terminated} terminated employee(s) were used to calculate turnover and not scored.` });
  if (counts.alreadyRun) issues.push({ level: 'info', message: `${counts.alreadyRun} contact(s) were already processed this month and were skipped (one run per contact per month).` });
  const noAddress = records.filter((r) => !r.skipReason && !r.rec.hasStreetAddress && r.rec.distanceMiles == null).length;
  if (noAddress) issues.push({ level: 'info', message: `${noAddress} record(s) have no street address, so commute distance will be scored as neutral.` });
  if (type === 'current') {
    const noHire = records.filter((r) => !r.skipReason && !r.rec.hireDate).length;
    if (noHire) issues.push({ level: 'warning', message: `${noHire} record(s) have no readable hire date, so tenure will be scored as neutral.` });
  }
  const SHARED = /^(hr|humanresources|human\.resources|info|admin|test|noreply|no-reply|office|frontdesk|careers|jobs)@/;
  const suspicious = records.filter((r) => !r.skipReason && (SHARED.test(r.rec.email) || /^test\b|\btest$/i.test(r.rec.lastName) || /^test\b/i.test(r.rec.name)));
  if (suspicious.length) issues.push({ level: 'warning', message: `${suspicious.length} record(s) look like test or shared accounts (e.g. ${suspicious.slice(0, 3).map((r) => r.rec.name).join('; ')}). Remove them if they are not real people.` });
  const provided = records.some((r) => r.rec.providedDomains);
  if (provided) issues.push({ level: 'warning', message: 'The file contains pre-filled 1-10 domain score columns. Those values will be used where no social signal is found and labelled "client-provided" in the results.' });

  const turnover = type === 'current' ? computeTurnover(all, opts.now) : [];
  return { headerMap, records, issues, stats: { rows: rows.length, billable, ...counts }, turnover };
}

module.exports = { parseFile, buildIntake, computeTurnover, IntakeError, REQUIRED, monthsBetween };
