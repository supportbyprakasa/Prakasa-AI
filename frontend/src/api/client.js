import axios from 'axios';
import { apiBaseUrl } from './endpoint';

const api = axios.create({
  baseURL: apiBaseUrl,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('prakasa.token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      // A request sent with an OLDER token (still in flight when a password
      // change issued a fresh session) must not sign the browser out.
      const sent = String(err.config?.headers?.Authorization || '');
      const current = localStorage.getItem('prakasa.token');
      if (sent && current && sent !== `Bearer ${current}`) return Promise.reject(err);
      localStorage.removeItem('prakasa.token');
      const isPublicRoute =
        location.pathname.startsWith('/login') ||
        location.pathname.startsWith('/verify/');
      if (!isPublicRoute) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
