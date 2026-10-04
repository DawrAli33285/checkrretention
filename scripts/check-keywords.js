// Prints a review sheet for the keyword library (server/scoring/keywords.json):
// phrase counts per domain, very short/generic phrases, and full-sentence
// phrases that will rarely appear verbatim in real posts.
const { library } = require('../server/scoring/signals');

let total = 0;
const rows = [];
for (const [domain, phrases] of Object.entries(library.domains)) {
  for (const [phrase, meta] of Object.entries(phrases)) {
    total++;
    const words = phrase.split(/\s+/).length;
    const notes = [];
    if (words <= 1) notes.push('single word: check for false positives');
    if (words >= 6) notes.push('long sentence: rarely matches verbatim');
    rows.push({ domain, polarity: meta.polarity, severity: meta.severity, phrase, notes: notes.join('; ') });
  }
}
console.log(`Keyword library v${library.version}: ${total} phrases`);
for (const d of Object.keys(library.domains)) console.log(`  ${d}: ${Object.keys(library.domains[d]).length}`);
if (process.argv.includes('--csv')) {
  console.log('domain,polarity,severity,phrase,notes');
  rows.forEach((r) => console.log([r.domain, r.polarity, r.severity, JSON.stringify(r.phrase), JSON.stringify(r.notes)].join(',')));
} else {
  const flagged = rows.filter((r) => r.notes);
  console.log(`\n${flagged.length} phrases flagged for review (run with --csv for the full sheet):`);
  flagged.forEach((r) => console.log(`  [${r.domain}] "${r.phrase}" - ${r.notes}`));
}
