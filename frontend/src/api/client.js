import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
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
