import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session';
import Shell from './components/Shell';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Jobs from './pages/Jobs';
import JobView from './pages/JobView';
import Invoices from './pages/Invoices';
import Account from './pages/Account';
import AdminHome from './pages/admin/AdminHome';
import AdminUsers from './pages/admin/AdminUsers';
import AdminJobs from './pages/admin/AdminJobs';
import AdminInvoices from './pages/admin/AdminInvoices';

function Protected({ children, admin }) {
  const { user, status } = useSession();
  if (status === 'loading') return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/upload/:type" element={<Protected><Upload /></Protected>} />
      <Route path="/jobs" element={<Protected><Jobs /></Protected>} />
      <Route path="/jobs/:id" element={<Protected><JobView /></Protected>} />
      <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/admin" element={<Protected admin><AdminHome /></Protected>} />
      <Route path="/admin/users" element={<Protected admin><AdminUsers /></Protected>} />
      <Route path="/admin/jobs" element={<Protected admin><AdminJobs /></Protected>} />
      <Route path="/admin/invoices" element={<Protected admin><AdminInvoices /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
