import { NavLink } from 'react-router-dom';

const cls = ({ isActive }) => `px-3 py-1.5 rounded-md text-sm font-medium ${isActive ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`;
export default function AdminNav() {
  return (
    <div className="flex flex-wrap gap-1 mb-6">
      <NavLink end to="/admin" className={cls}>Overview</NavLink>
      <NavLink to="/admin/users" className={cls}>Clients & users</NavLink>
      <NavLink to="/admin/jobs" className={cls}>All runs</NavLink>
      <NavLink to="/admin/invoices" className={cls}>Invoices</NavLink>
    </div>
  );
}
