// Financial impact. Ported from the original financialCalculations.js, which
// had the right rules: client figures first, labelled benchmarks second, and
// never an invented exit probability.
export const DEFAULT_FINANCIAL = {
  benchmarkReplacementMin: 56300,
  benchmarkReplacementMax: 60000,
  benchmarkLabel: 'Industry benchmark (healthcare)',
  productivityPercentOfSalary: 18,
};

const has = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function potentialLoss(emp, cfg) {
  const f = emp.financials || {};
  const replacement = has(f.replacementCost)
    ? { value: f.replacementCost, source: 'client', label: 'Client role cost' }
    : { value: (cfg.benchmarkReplacementMin + cfg.benchmarkReplacementMax) / 2, source: 'benchmark', label: cfg.benchmarkLabel };
  const vacancy = has(f.vacancyDays) && has(f.dailyLoadedLaborCost)
    ? { value: f.vacancyDays * f.dailyLoadedLaborCost, source: 'client', label: `${f.vacancyDays} days x $${f.dailyLoadedLaborCost}/day` }
    : { value: 0, source: 'unavailable', label: 'Not supplied' };
  const overtime = has(f.overtimeOrContractCost)
    ? { value: f.overtimeOrContractCost, source: 'client', label: 'Client overtime/contract cost' }
    : { value: 0, source: 'unavailable', label: 'Not supplied' };
  const productivity = has(f.productivityDisruptionCost)
    ? { value: f.productivityDisruptionCost, source: 'client', label: 'Client productivity cost' }
    : has(f.annualSalary)
      ? { value: f.annualSalary * (cfg.productivityPercentOfSalary / 100), source: 'benchmark', label: `${cfg.productivityPercentOfSalary}% of salary (benchmark)` }
      : { value: 0, source: 'unavailable', label: 'Not supplied' };
  const parts = { replacement, vacancy, overtime, productivity };
  const total = Object.values(parts).reduce((a, p) => a + p.value, 0);
  return { total, parts, usesBenchmark: Object.values(parts).some((p) => p.source === 'benchmark') };
}

export function aggregate(rows, cfg) {
  const scored = rows.filter((r) => r.status === 'done');
  const enriched = scored.map((r) => ({ row: r, loss: potentialLoss(r, cfg) }));
  const atRisk = enriched.filter((e) => e.row.band === 'At risk');
  const watch = enriched.filter((e) => e.row.band === 'Watch');
  const sum = (arr) => arr.reduce((a, e) => a + e.loss.total, 0);
  const group = (keyFn) => {
    const g = {};
    enriched.forEach((e) => {
      const k = keyFn(e.row) || 'Unspecified';
      g[k] = g[k] || { key: k, count: 0, atRisk: 0, exposure: 0 };
      g[k].count++;
      if (e.row.band === 'At risk') { g[k].atRisk++; g[k].exposure += e.loss.total; }
    });
    return Object.values(g).sort((a, b) => b.exposure - a.exposure || b.atRisk - a.atRisk);
  };
  return {
    scored: scored.length,
    atRiskCount: atRisk.length,
    watchCount: watch.length,
    atRiskExposure: sum(atRisk),
    watchExposure: sum(watch),
    avgLoss: enriched.length ? sum(enriched) / enriched.length : 0,
    usesBenchmark: enriched.some((e) => e.loss.usesBenchmark),
    byDepartment: group((r) => r.department),
    byJobClass: group((r) => r.jobClass),
    atRisk,
  };
}

export const shortMoney = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
