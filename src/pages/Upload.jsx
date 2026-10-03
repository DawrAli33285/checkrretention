import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UploadCloud, FileSpreadsheet, Download } from 'lucide-react';
import { api, money } from '../lib/api';
import { useSession } from '../lib/session';
import { Notice, PageHeader } from '../components/ui';

const COPY = {
  prehire: {
    title: 'Pre-Hire Analysis', subtitle: 'Upload your applicant list. Each candidate is processed once per upload.',
    required: ['Candidate (Last, Suffix First MI)', 'Email Address'],
    recommended: ['Primary Phone', 'Address 1, City, State/Province Code, Zip/Postal Code', 'Opportunity Title or Source Job', 'Department Name'],
    template: '/templates/prehire_template.csv', sample: '/templates/prehire_sample.csv',
  },
  current: {
    title: 'Current Staff Analysis', subtitle: 'Upload a monthly staff snapshot. One run per month; each contact is scored once per month.',
    required: ['Employee Name (Last Suffix, First MI)', 'E-mail Address or Phone', 'Hire Date', 'Job Class', 'Department'],
    recommended: ['Address Line 1 + Address Line 2, City, State Zip Code', 'Organization', 'Division', 'Termination Date, Termination Reason and Employment Status for leavers in the last 12 months (used for job-class turnover)'],
    template: '/templates/current_staff_template.csv', sample: '/templates/current_staff_sample.csv',
  },
};
const FIELD_LABELS = { name: 'Name', email: 'Email', phone: 'Phone', address1: 'Street address', hireDate: 'Hire date', termDate: 'Termination date', department: 'Department', jobClass: 'Job class', organization: 'Organization', division: 'Division', zip: 'ZIP', cityStateZip: 'City/State/ZIP', employmentStatus: 'Employment status', distanceMiles: 'Distance (miles)' };

export default function Upload() {
  const { type } = useParams();
  const copy = COPY[type];
  const { refresh } = useSession();
  const navigate = useNavigate();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!copy) return <Notice tone="error">Unknown upload type.</Notice>;

  const choose = async (f) => {
    if (!f) return;
    setFile(f); setPreview(null); setError('');
    if (!/\.(csv|xlsx)$/i.test(f.name)) { setError('Upload a .csv or .xlsx file. Old .xls files must be re-saved as .xlsx.'); return; }
    const form = new FormData(); form.append('type', type); form.append('file', f);
    setBusy(true);
    try { setPreview(await api('/jobs/preview', { method: 'POST', form })); } catch (e) { setError(e.message + (e.body?.details?.found ? ` Columns found: ${e.body.details.found.join(', ')}` : '')); } finally { setBusy(false); }
  };

  const start = async () => {
    const form = new FormData(); form.append('type', type); form.append('file', file);
    setBusy(true); setError('');
    try { const { job } = await api('/jobs', { method: 'POST', form }); await refresh(); navigate(`/jobs/${job._id}`); } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title={copy.title} subtitle={copy.subtitle} actions={<>
        <a className="btn-secondary" href={copy.template} download><Download size={16} />Blank template</a>
        <a className="btn-secondary" href={copy.sample} download><FileSpreadsheet size={16} />Sample file</a>
      </>} />
      <div
        className={`card border-2 border-dashed p-10 text-center cursor-pointer transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-500'}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files[0]); }}
      >
        <input ref={input} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { choose(e.target.files[0]); e.target.value = ''; }} />
        <UploadCloud className="mx-auto text-brand-500" size={40} />
        <p className="mt-3 text-slate-700">Drag and drop your file, or click to browse</p>
        <p className="text-xs text-slate-500 mt-1">.csv or .xlsx, up to 4 MB (larger files: save as CSV or split)</p>
        {file && <p className="mt-3 text-sm font-medium text-brand-600">{file.name}</p>}
      </div>

      {busy && !preview && <p className="mt-4 text-sm text-slate-500">Checking file…</p>}
      {error && <Notice tone="error" className="mt-4">{error}</Notice>}

      {preview && (
        <div className="card mt-6 p-5 space-y-4">
          <div className="grid sm:grid-cols-4 gap-3 text-center">
            <div><div className="text-2xl font-semibold text-brand-900">{preview.stats.rows}</div><div className="text-xs text-slate-500">rows in file</div></div>
            <div><div className="text-2xl font-semibold text-brand-900">{preview.stats.billable}</div><div className="text-xs text-slate-500">will be scored</div></div>
            <div><div className="text-2xl font-semibold text-slate-500">{preview.stats.rows - preview.stats.billable}</div><div className="text-xs text-slate-500">skipped (not charged)</div></div>
            <div><div className="text-2xl font-semibold text-brand-900">{money(preview.cost)}</div><div className="text-xs text-slate-500">{money(preview.pricePerRecord)} per record</div></div>
          </div>
          {preview.issues.map((i, n) => <Notice key={n} tone={i.level === 'warning' ? 'warning' : 'info'}>{i.message}</Notice>)}
          {preview.turnoverClasses > 0 && <Notice tone="success">Job-class turnover was calculated for {preview.turnoverClasses} job classes from the leavers in this file.</Notice>}
          <details className="text-sm">
            <summary className="cursor-pointer text-brand-600 font-medium">Column mapping and first rows</summary>
            <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries(preview.mapping).filter(([k]) => FIELD_LABELS[k]).map(([k, v]) => <div key={k} className="flex justify-between border-b border-slate-100 py-1"><span className="text-slate-500">{FIELD_LABELS[k]}</span><span className="text-slate-800">{v}</span></div>)}
            </div>
            <table className="mt-3 w-full text-xs"><tbody>{preview.sample.map((s, i) => <tr key={i} className="border-b border-slate-100"><td className="py-1 pr-2">{s.name}</td><td className="pr-2">{s.email}</td><td className="pr-2">{s.jobClass}</td><td>{s.department}</td></tr>)}</tbody></table>
          </details>
          {!preview.enoughCredits && <Notice tone="error">Not enough credits: this run costs {money(preview.cost)} and your balance is {money(preview.credits)}. Contact PrognostiCare to add credits.</Notice>}
          {preview.providerMode === 'demo' && <Notice tone="warning">Demo mode: social signals will be simulated. Use this to test the process, not to make decisions about real people.</Notice>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => { setFile(null); setPreview(null); }}>Choose another file</button>
            <button className="btn-primary" disabled={busy || !preview.enoughCredits} onClick={start}>{busy ? 'Starting…' : `Start analysis${preview.cost ? ` (${money(preview.cost)})` : ''}`}</button>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        <div className="card p-4"><h3 className="text-sm font-semibold text-brand-900 mb-2">Required columns</h3><ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">{copy.required.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="card p-4"><h3 className="text-sm font-semibold text-brand-900 mb-2">Recommended</h3><ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">{copy.recommended.map((r) => <li key={r}>{r}</li>)}</ul></div>
      </div>
      <p className="text-xs text-slate-500 mt-4">Column names are matched flexibly (for example "Department Name" or "Department"). See <Link to="/jobs" className="underline">Results</Link> for earlier runs.</p>
    </div>
  );
}
