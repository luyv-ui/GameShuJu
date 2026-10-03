import { createContext, useContext, useEffect, useState } from 'react';

type Role = 'investor' | 'analyst' | 'admin';
type AuthState = { authenticated: boolean; mode: 'local' | 'external'; user: { id: string; name: string; role: Role } | null; csrfToken: string | null; loginUrl: string | null };
const AuthContext = createContext<AuthState | null>(null);
let csrfToken: string | null = null;

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

export function useAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error('AuthProvider is missing');
  return { ...state, canWrite: state.user?.role === 'analyst' || state.user?.role === 'admin', canAdmin: state.user?.role === 'admin' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error('无法获取登录状态');
      const result = await response.json() as AuthState;
      if (active) { csrfToken = result.csrfToken; setState(result); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法获取登录状态'); });
    return () => { active = false; };
  }, []);
  if (error) return <div className="auth-screen" role="alert"><h1>连接失败</h1><p>{error}</p><button className="primary-button" onClick={() => window.location.reload()}>重试</button></div>;
  if (!state) return <div className="auth-screen" role="status">正在连接工作空间...</div>;
  if (!state.authenticated) return <div className="auth-screen"><h1>游观</h1><p>请登录后查看游戏投资情报。</p>{state.loginUrl && <a className="primary-button" href={state.loginUrl}>登录工作空间</a>}</div>;
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
