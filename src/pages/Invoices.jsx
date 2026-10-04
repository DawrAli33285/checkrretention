import { useEffect, useState } from 'react';
import { api, fmtDate, money } from '../lib/api';
import { BRAND } from '../lib/brand';
import { Empty, PageHeader, StatusPill } from '../components/ui';

export default function Invoices() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/invoices').then((d) => setList(d.invoices)).catch(() => setList([])); }, []);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Invoices" subtitle={`Paid invoices are added to your credits.${BRAND.supportEmail ? ` Questions: ${BRAND.supportEmail}` : ''}`} />
      {!list ? <p className="text-sm text-slate-500">Loading…</p> : list.length === 0 ? <Empty>No invoices yet.</Empty> : (
        <div className="card divide-y divide-slate-100">{list.map((i) => (
          <div key={i._id} className="flex items-center justify-between px-4 py-3">
            <div><div className="text-sm font-medium">#{String(i._id).slice(-8).toUpperCase()} · {money(i.amount)}</div><div className="text-xs text-slate-500">{fmtDate(i.createdAt)}{i.description ? ` · ${i.description}` : ''}</div></div>
            <StatusPill status={i.status} />
          </div>))}</div>
      )}
    </div>
  );
}
