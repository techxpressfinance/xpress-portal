import axios from 'axios';
import { requestSettled, requestStarted } from '../lib/navProgress';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

let accessToken: string | null = null;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

const IMPERSONATION_KEY = 'impersonation-session';

export interface ImpersonationSession {
  token: string;
  userName: string;
  userRole: string;
}

export function getImpersonationSession(): ImpersonationSession | null {
  const raw = sessionStorage.getItem(IMPERSONATION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImpersonationSession;
  } catch {
    return null;
  }
}

export function startImpersonationSession(session: ImpersonationSession) {
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(session));
}

export function endImpersonationSession() {
  sessionStorage.removeItem(IMPERSONATION_KEY);
}

export function getAccessToken() {
  return accessToken;
}

export function getCsrfToken(): string {
  const pair = document.cookie.split('; ').find((r) => r.startsWith('csrf_token='));
  return pair ? decodeURIComponent(pair.slice('csrf_token='.length)) : '';
}

/**
 * Resolve the tenant slug the same way the backend does: from the Host
 * subdomain, or from VITE_TENANT_SLUG when the portal is served on a host
 * with no tenant subdomain. The localStorage override, ?tenant= param and the
 * bare 'default' fallback are development conveniences only — in production
 * they let a misconfigured deployment quietly talk to the wrong tenant.
 */
export function getTenantSlug(): string | null {
  if (import.meta.env.DEV) {
    const stored = localStorage.getItem('dev-tenant-slug');
    if (stored) return stored;
  }

  const host = window.location.hostname;
  const parts = host.split('.');
  const isSubdomain = parts.length >= 3 || (parts.length === 2 && parts[1] === 'localhost');
  if (isSubdomain) {
    const sub = parts[0];
    if (sub !== 'www' && !/^\d+$/.test(sub)) {
      return sub;
    }
  }

  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tenant');
    if (fromQuery) return fromQuery;
  }
  return import.meta.env.VITE_TENANT_SLUG || (import.meta.env.DEV ? 'default' : null);
}

api.interceptors.request.use((config) => {
  // Counted toward the page-load bar when fired while a page is loading. The
  // flag rides on the config so a 401 retry of the same request counts once.
  const tracked = config as typeof config & { _navTracked?: boolean };
  if (!tracked._navTracked && requestStarted()) tracked._navTracked = true;
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Attach tenant slug header
  const slug = getTenantSlug();
  if (slug) {
    config.headers['X-Tenant-Slug'] = slug;
  }
  // Attach CSRF token on state-changing requests
  const method = config.method?.toLowerCase();
  if (method && ['post', 'patch', 'put', 'delete'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) {
      config.headers['X-CSRF-Token'] = csrf;
    }
  }
  return config;
});

function settleNavTracking(config: unknown) {
  const tracked = config as { _navTracked?: boolean } | undefined;
  if (tracked?._navTracked) {
    tracked._navTracked = false;
    requestSettled();
  }
}

api.interceptors.response.use(
  (response) => {
    settleNavTracking(response.config);
    return response;
  },
  async (error) => {
    settleNavTracking(error.config);
    const original = error.config;
    // Don't retry auth endpoints to prevent infinite loops
    const isAuthUrl = original.url?.startsWith('/auth/');
    if (error.response?.status === 401 && !original._retry && !isAuthUrl) {
      // An expired impersonation token can't be refreshed — end the session
      // and return to the admin view instead of refreshing into the admin token.
      if (getImpersonationSession()) {
        endImpersonationSession();
        window.location.href = '/admin';
        return Promise.reject(error);
      }
      original._retry = true;

      if (isRefreshing) {
        // Queue this request until the in-flight refresh completes
        return new Promise((resolve) => {
          addRefreshSubscriber((newToken: string) => {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(original));
          });
        });
      }

      isRefreshing = true;
      try {
        const { data } = await axios.post('/api/auth/refresh', null, {
          withCredentials: true,
          headers: { 'X-CSRF-Token': getCsrfToken() },
        });
        setAccessToken(data.access_token);
        onTokenRefreshed(data.access_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch (refreshError) {
        setAccessToken(null);
        refreshSubscribers = [];
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
