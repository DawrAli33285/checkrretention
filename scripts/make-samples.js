// Generates the synthetic sample files in /samples and blank templates in
// /public/templates. Every person is fictional (example.com addresses).
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { seededRandom } = require('../server/providers/util');

const rnd = seededRandom('prognosticare-samples-v1');
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FIRST = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Quinn', 'Harper', 'Rowan', 'Emerson', 'Parker', 'Reese', 'Skyler', 'Dakota', 'Hayden', 'Kendall', 'Logan', 'Peyton', 'Sawyer', 'Blake', 'Cameron', 'Drew', 'Elliot', 'Finley'];
const LAST = ['Ashford', 'Bellamy', 'Carrow', 'Dunmore', 'Ellison', 'Fairbanks', 'Garrity', 'Holloway', 'Iverson', 'Jessup', 'Kingsley', 'Lockhart', 'Merriweather', 'Northcott', 'Oakley', 'Pembrook', 'Quimby', 'Rutherford', 'Stanwick', 'Thornbury', 'Underhill', 'Vance', 'Whitlock', 'Yardley'];
const CLASSES = [['Staff Nurse RN', 'Nursing'], ['Medical Asst', 'Primary Care'], ['Housekeeper', 'Environmental Services'], ['Resp Therapist', 'Respiratory'], ['Surgery Tech', 'Surgery'], ['Medical Receptionist', 'Primary Care']];
const TOWNS = [['Greenfield', 'IN', '46140'], ['New Palestine', 'IN', '46163'], ['McCordsville', 'IN', '46055'], ['Fortville', 'IN', '46040'], ['Indianapolis', 'IN', '46229'], ['Shelbyville', 'IN', '46176']];
const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

function person(i) {
  const first = FIRST[i % FIRST.length]; const last = LAST[(i * 7 + Math.floor(i / FIRST.length) * 5) % LAST.length];
  const [city, st, zip] = pick(TOWNS);
  return { first, last, email: `${first}.${last}${i}@example.com`.toLowerCase(), phone: `(317) 555-${String(1000 + i).slice(-4)}`, street: `${100 + Math.floor(rnd() * 9800)} ${pick(['Maple', 'Oak', 'Cedar', 'Birch', 'Walnut'])} ${pick(['St', 'Ave', 'Ln', 'Ct'])}`, city, st, zip, miles: Math.round(rnd() * 45 * 10) / 10 };
}

const staff = [];
for (let i = 0; i < 48; i++) {
  const p = person(i); const [jobClass, dept] = pick(CLASSES);
  const terminated = i >= 40; // last 8 rows are recent leavers, used for turnover
  staff.push({
    'Employee Number': 5000 + i,
    'Employee Name (Last Suffix, First MI)': `${p.last}, ${p.first}`,
    'Address Line 1 + Address Line 2': p.street,
    'City, State Zip Code (Formatted)': `${p.city}, ${p.st} ${p.zip}`,
    'E-mail Address': i === 12 ? '' : p.email,
    'Home Phone (Formatted)': i === 12 ? '' : p.phone,
    'Hire Date': fmt(daysAgo(30 + Math.floor(rnd() * 3000))),
    'Term Date': terminated ? fmt(daysAgo(10 + Math.floor(rnd() * 300))) : '',
    'Termination Reason': terminated ? pick(['Another Job', 'Resigned', 'Family Obligation', 'Personal Reasons']) : '',
    'Employment Status': terminated ? 'Terminated' : 'Active',
    Organization: 'Example Regional Health',
    Division: pick(['Clinical Operations', 'Support Services']),
    Department: dept,
    'Job Class': jobClass,
    'Distance (Miles)': p.miles,
    'Salary Range': pick(['40k-50k', '50k-60k', '60k-80k']),
  });
}
staff.push({ ...staff[3], 'Employee Number': 5999 }); // duplicate contact: merged, not charged

const prehire = [];
for (let i = 100; i < 125; i++) {
  const p = person(i); const [jobClass, dept] = pick(CLASSES);
  prehire.push({
    'Candidate (Last, Suffix First MI)': `${p.last}, ${p.first}`,
    'Source Job': rnd() < 0.3 ? `${jobClass} - R${6000 + i}` : '',
    'Opportunity Title': `${jobClass} - Days`,
    'Source Job Code': `R${6000 + i}${100 + i}`,
    'Department Name': dept,
    'Email Address': p.email,
    'Primary Phone': `+1 317-555-${String(2000 + i).slice(-4)}`,
    'Address 1': i % 4 === 0 ? '' : p.street,
    City: p.city,
    'State/Province Code': p.st,
    'Zip/Postal Code': p.zip,
    'Distance (Miles)': i % 4 === 0 ? '' : p.miles,
  });
}
prehire.push({ ...prehire[2], 'Opportunity Title': 'Medical Asst - Evenings' }); // same person, second requisition

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'samples'), { recursive: true });
fs.mkdirSync(path.join(root, 'public', 'templates'), { recursive: true });
fs.writeFileSync(path.join(root, 'samples', 'current_staff_sample.csv'), Papa.unparse(staff));
fs.writeFileSync(path.join(root, 'samples', 'prehire_sample.csv'), Papa.unparse(prehire));
fs.copyFileSync(path.join(root, 'samples', 'current_staff_sample.csv'), path.join(root, 'public', 'templates', 'current_staff_sample.csv'));
fs.copyFileSync(path.join(root, 'samples', 'prehire_sample.csv'), path.join(root, 'public', 'templates', 'prehire_sample.csv'));
fs.writeFileSync(path.join(root, 'public', 'templates', 'current_staff_template.csv'), Papa.unparse([Object.fromEntries(Object.keys(staff[0]).filter((k) => k !== 'Distance (Miles)').map((k) => [k, '']))]).split('\n')[0] + '\n');
fs.writeFileSync(path.join(root, 'public', 'templates', 'prehire_template.csv'), Papa.unparse([Object.fromEntries(Object.keys(prehire[0]).filter((k) => k !== 'Distance (Miles)').map((k) => [k, '']))]).split('\n')[0] + '\n');
console.log(`samples: ${staff.length} staff rows, ${prehire.length} pre-hire rows`);
