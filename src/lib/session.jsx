import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';

const SessionCtx = createContext(null);

// status: 'loading' | 'ready' | 'unavailable'
export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('loading');
  const [problem, setProblem] = useState('');
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const cfg = await api('/config');
      setConfig(cfg);
      if (cfg.needsSetup) { setUser(null); setStatus('ready'); return; }
      try { const { user: u } = await api('/auth/session'); setUser(u); } catch { setUser(null); }
      setStatus('ready');
    } catch (e) {
      setProblem(e.message); setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser((u) => { if (u) setExpired(true); return null; }); });
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    try { const { user: u } = await api('/auth/me'); setUser(u); return u; } catch { setUser(null); return null; }
  }, []);

  const login = async (email, password) => {
    const { user: u } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setExpired(false); setUser(u); return u;
  };
  const completeSetup = async (form) => {
    const { user: u } = await api('/auth/setup', { method: 'POST', body: form });
    setConfig((c) => ({ ...c, needsSetup: false })); setUser(u); return u;
  };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); };

  return (
    <SessionCtx.Provider value={{ user, config, status, problem, expired, login, logout, refresh, reload: load, completeSetup, setUser }}>
      {children}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
