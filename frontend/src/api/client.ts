import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
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
      try {
        const { data } = await axios.post('/api/auth/refresh', null, {
          withCredentials: true,
          headers: { 'X-CSRF-Token': getCsrfToken() },
        });
        setAccessToken(data.access_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch {
        setAccessToken(null);
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
