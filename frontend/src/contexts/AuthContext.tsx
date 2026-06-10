import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import api, {
  endImpersonationSession,
  getCsrfToken,
  getImpersonationSession,
  setAccessToken,
  startImpersonationSession,
  type ImpersonationSession,
} from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  impersonation: ImpersonationSession | null;
  login: (email: string, password: string) => Promise<void>;
  superAdminLogin: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string, ref?: string) => Promise<User>;
  setupAccount: (token: string, password: string) => Promise<void>;
  impersonate: (userId: string) => Promise<void>;
  stopImpersonation: () => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  impersonation: null,
  login: async () => { },
  superAdminLogin: async () => { },
  register: async () => ({} as User),
  setupAccount: async () => { },
  impersonate: async () => { },
  stopImpersonation: () => { },
  logout: () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<ImpersonationSession | null>(() => getImpersonationSession());

  const fetchUser = useCallback(async (throwOnError = false) => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch (err) {
      setUser(null);
      setAccessToken(null);
      if (throwOnError) throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // An active impersonation session (admin viewing as another user) carries its
    // own access token — restore it instead of refreshing the admin session.
    const impSession = getImpersonationSession();
    if (impSession) {
      setAccessToken(impSession.token);
      fetchUser(true).catch(() => {
        endImpersonationSession();
        setImpersonation(null);
      });
      return;
    }
    // 1. Initialize CSRF cookie via a GET request
    // 2. Then attempt session refresh using the httpOnly refresh_token cookie
    api
      .get('/auth/csrf-token')
      .then(() =>
        axios.post('/api/auth/refresh', null, {
          withCredentials: true,
          headers: { 'X-CSRF-Token': getCsrfToken() },
        })
      )
      .then(({ data }) => {
        setAccessToken(data.access_token);
        return fetchUser();
      })
      .catch(() => {
        setLoading(false);
      });
  }, [fetchUser]);

  const login = async (email: string, password: string): Promise<void> => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.access_token);
    try {
      await fetchUser(true);
    } catch {
      throw new Error('Login succeeded but failed to load your account. Please try again.');
    }
  };

  const superAdminLogin = async (email: string, password: string) => {
    const csrf = getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const { data } = await axios.post('/api/super-admin/login', { email, password }, {
      withCredentials: true,
      headers,
    });
    setAccessToken(data.access_token);
    try {
      await fetchUser(true);
    } catch {
      throw new Error('Login succeeded but failed to load your account. Please try again.');
    }
  };

  const register = async (name: string, email: string, phone: string, password: string, ref?: string): Promise<User> => {
    const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const { data } = await api.post(`/auth/register${params}`, {
      full_name: name,
      email,
      phone: phone || null,
      password,
    });
    return data;
  };

  const setupAccount = async (token: string, password: string) => {
    const { data } = await api.post('/auth/setup-account', { token, password });
    setAccessToken(data.access_token);
    try {
      await fetchUser(true);
    } catch {
      throw new Error('Account created but failed to sign in. Please log in manually.');
    }
  };

  const impersonate = async (userId: string) => {
    const { data } = await api.post(`/users/${userId}/impersonate`);
    startImpersonationSession({
      token: data.access_token,
      userName: data.user.full_name,
      userRole: data.user.role,
    });
    // Full reload so the whole app (routes, tenant branding, polling) boots as the target user.
    window.location.href = '/';
  };

  const stopImpersonation = () => {
    endImpersonationSession();
    // Reload back into the admin session restored from the refresh cookie.
    window.location.href = '/admin';
  };

  const logout = () => {
    if (impersonation) {
      stopImpersonation();
      return;
    }
    // Await the server blacklisting the refresh token before clearing local state,
    // but still clear state on failure to avoid trapping the user in a logged-in state.
    api.post('/auth/logout').catch(() => { }).finally(() => {
      setAccessToken(null);
      setUser(null);
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, impersonation, login, superAdminLogin, register, setupAccount, impersonate, stopImpersonation, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
