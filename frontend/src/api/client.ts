import axios from 'axios';

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

export function getAccessToken() {
  return accessToken;
}

export function getCsrfToken(): string {
  const pair = document.cookie.split('; ').find((r) => r.startsWith('csrf_token='));
  return pair ? decodeURIComponent(pair.slice('csrf_token='.length)) : '';
}

export function getTenantSlug(): string | null {
  const stored = localStorage.getItem('dev-tenant-slug');
  if (stored) return stored;

  const host = window.location.hostname;
  const parts = host.split('.');
  const isSubdomain = parts.length >= 3 || (parts.length === 2 && parts[1] === 'localhost');
  if (isSubdomain) {
    const sub = parts[0];
    if (sub !== 'www' && !/^\d+$/.test(sub)) {
      return sub;
    }
  }

  const params = new URLSearchParams(window.location.search);
  return params.get('tenant') || 'default';
}

api.interceptors.request.use((config) => {
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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    // Don't retry auth endpoints to prevent infinite loops
    const isAuthUrl = original.url?.startsWith('/auth/');
    if (error.response?.status === 401 && !original._retry && !isAuthUrl) {
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
