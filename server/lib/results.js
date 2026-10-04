// Shapes records for the UI and builds the downloadable report.
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const { DOMAINS, DEFAULT_BANDS, DIST_TENURE_THRESHOLDS, TURNOVER_BANDS, SOCIAL_POINTS, RETENTION_BANDS, woePoints } = require('../scoring/model');

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function toRow(r) {
  const i = r.input || {};
  const s = r.score || {};
  const b = s.breakdown || {};
  return {
    id: String(r._id),
    rowIndex: r.rowIndex,
    status: r.status,
    skipReason: r.skipReason || '',
    error: r.error || '',
    employeeNumber: i.employeeNumber || '',
    name: i.name || '',
    email: i.email || '',
    phone: i.phone || '',
    organization: i.organization || '',
    division: i.division || '',
    department: i.department || '',
    jobClass: i.jobClass || '',
    hireDate: fmtDate(i.hireDate),
    salaryRange: i.salaryRange || '',
    retentionScore: s.retentionScore ?? null,
    band: s.band || '',
    rightFit: s.rightFit ?? null,
    breakdown: b,
    domains: r.social?.domains || {},
    jobSatisfaction: r.social?.insight?.jobSatisfaction ?? null,
    socialSource: r.social?.source || '',
    postsConsidered: r.social?.postsConsidered ?? 0,
    evidence: r.social?.evidence || [],
    profiles: r.enrichment?.profiles || {},
    matchLikelihood: r.enrichment?.likelihood ?? null,
    factors: r.factors || {},
    flags: r.flags || [],
    financials: i.financials || {},
  };
}

const SOURCE_LABEL = { social: 'Social listening', demo: 'DEMO (simulated)', provided: 'Client-provided', none: 'No signal' };

function flatRow(x, jobType) {
  const row = {
    'Row': x.rowIndex,
    'Status': x.status,
    [jobType === 'prehire' ? 'Candidate' : 'Employee']: x.name,
    'Employee Number': x.employeeNumber,
    'Email': x.email,
    'Phone': x.phone,
    'Organization': x.organization,
    'Division': x.division,
    'Department': x.department,
    'Job Class': x.jobClass,
    'Retention Score (points)': x.retentionScore ?? '',
    'Outlook': x.band,
    'Right Fit (score >= 20)': x.rightFit === null ? '' : x.rightFit ? 'Yes' : 'No',
  };
  for (const d of DOMAINS) row[`${d.label} pressure (1-10)`] = x.domains?.[d.key] ?? '';
  row['Job Satisfaction pressure (1-10, insight only)'] = x.jobSatisfaction ?? '';
  row['Points: Age'] = x.breakdown.age ?? '';
  row['Points: Distance'] = x.breakdown.distance ?? '';
  row['Points: Tenure'] = x.breakdown.tenure ?? '';
  row['Points: Turnover'] = x.breakdown.turnover ?? '';
  for (const d of DOMAINS) row[`Points: ${d.label}`] = x.breakdown[d.key] ?? '';
  row['Distance (miles)'] = x.factors.distanceMiles ?? '';
  row['Tenure (months)'] = x.factors.tenureMonths ?? '';
  row['Job Class Turnover %'] = x.factors.turnoverPct ?? '';
  row['Signal Source'] = SOURCE_LABEL[x.socialSource] || '';
  row['Posts Considered'] = x.postsConsidered;
  row['Top Evidence'] = x.evidence.slice(0, 5).map((e) => `${e.phrase} (x${e.count})`).join('; ');
  row['Notes'] = [x.skipReason, x.error, ...x.flags].filter(Boolean).join('; ');
  return row;
}

const METHOD_NOTES = [
  ['Retention Score', 'Sum of points: Age (off by default) + Distance + Tenure + Job-class Turnover + Financial + Schedule + Work-Life Balance + Communication. Model per "Retention Calculation.xlsx".'],
  ['Outlook', 'Likely to stay: 20 or more. Watch: 0 to 19. At risk: below 0. Points are not a probability or a percentage.'],
  ['Domain pressure (1-10)', '1 = no pressure found in recent public posts, 10 = heavy pressure. Converted to points: 1=+7, 2=+5, 3=+3, 4=+2, 5=+1, 6=0, 7=-1, 8=-3, 9=-5, 10=-7.'],
  ['No signal', 'When no posts are found, domain points are 0 (neutral). Nothing is estimated or randomised.'],
  ['Signal Source', 'Social listening = live data. DEMO = simulated for testing only, not real people data. Client-provided = values supplied in the upload file.'],
  ['Missing inputs', 'Missing distance, tenure or turnover score 0 points and are listed in Notes.'],
];

async function buildWorkbook(job, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PrognostiCare';
  const ws = wb.addWorksheet('Results');
  const flat = rows.map((r) => flatRow(r, job.type));
  const headers = flat.length ? Object.keys(flat[0]) : ['No results'];
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
  flat.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (job.providerMode === 'demo') {
    ws.insertRow(1, ['DEMO RUN: social signals in this file are simulated and do not describe the real people listed.']);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFB91C1C' } };
  }
  const notes = wb.addWorksheet('Method');
  notes.columns = [{ header: 'Item', key: 'a', width: 28 }, { header: 'Explanation', key: 'b', width: 120 }];
  notes.addRow({ a: 'File', b: job.fileName });
  notes.addRow({ a: 'Run type', b: job.type === 'prehire' ? 'Pre-hire' : 'Current staff' });
  notes.addRow({ a: 'Data mode', b: job.providerMode === 'demo' ? 'DEMO (simulated social signals)' : 'Live' });
  notes.addRow({ a: 'Model version', b: job.modelVersion });
  notes.addRow({ a: 'Processed', b: fmtDate(job.completedAt || job.updatedAt) });
  METHOD_NOTES.forEach(([a, b]) => notes.addRow({ a, b }));
  notes.getRow(1).font = { bold: true };
  if (job.turnover?.length) {
    const t = wb.addWorksheet('Turnover by Job Class');
    t.columns = [{ header: 'Job Class', key: 'jobClass', width: 40 }, { header: 'Annual Turnover %', key: 'pct', width: 18 }, { header: 'Active Headcount', key: 'headcount', width: 16 }, { header: 'Separations (12 mo)', key: 'separations', width: 18 }];
    job.turnover.forEach((r) => t.addRow(r));
    t.getRow(1).font = { bold: true };
  }
  return wb.xlsx.writeBuffer();
}

function buildCsv(job, rows) {
  const flat = rows.map((r) => flatRow(r, job.type));
  const csv = Papa.unparse(flat, { escapeFormulae: true });
  return job.providerMode === 'demo' ? `"DEMO RUN: simulated social signals, not real people data"\n${csv}` : csv;
}

// Point tables for the "How scores work" screen, read from the scoring model so
// the explanation can never drift from the math. Adjacent bands that earn the
// same points are merged to keep the table short.
function pointTables() {
  const merge = (list) => list.reduce((out, x) => {
    const last = out[out.length - 1];
    if (last && last.points === x.points) { last.to = x.to; last.label = `${last.from}-${x.to}${x.unit}`; return out; }
    out.push({ ...x, label: x.label });
    return out;
  }, []);
  const banded = (bands, unit) => merge(bands.map((b) => {
    const points = woePoints(b.min, bands, DIST_TENURE_THRESHOLDS).points;
    const [from, to] = b.label.replace(/ mo$/, '').split('-');
    return { label: b.label, from: from || b.label, to: to || '', unit, points };
  })).map(({ label, points }) => ({ label, points }));
  return {
    distance: banded(DEFAULT_BANDS.distance, ' mi').map((r) => ({ ...r, label: r.label.endsWith('mi') ? r.label : `${r.label} mi` })),
    tenure: banded(DEFAULT_BANDS.tenure, ' mo'),
    turnover: TURNOVER_BANDS.map(([lo, hi, points]) => ({ label: hi === Infinity ? `${lo}%+` : `${lo}-${hi}%`, points })),
    social: Object.entries(SOCIAL_POINTS).map(([level, points]) => ({ label: String(level), points })),
    bands: RETENTION_BANDS,
  };
}

module.exports = { toRow, buildWorkbook, buildCsv, pointTables };
