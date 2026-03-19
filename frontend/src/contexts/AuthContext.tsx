import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import api, { getCsrfToken, setAccessToken } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string, ref?: string) => Promise<User>;
  requestCode: (email: string) => Promise<void>;
  loginWithCode: (email: string, code: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => ({} as User),
  requestCode: async () => {},
  loginWithCode: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
      setAccessToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.access_token);
    await fetchUser();
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

  const requestCode = async (email: string) => {
    await api.post('/auth/request-code', { email });
  };

  const loginWithCode = async (email: string, code: string) => {
    const { data } = await api.post('/auth/verify-code', { email, code });
    setAccessToken(data.access_token);
    await fetchUser();
  };

  const logout = () => {
    api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, requestCode, loginWithCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
