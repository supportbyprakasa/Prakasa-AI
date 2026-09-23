// Production requests stay on the web origin and use the Vercel API rewrite.
// VITE_API_URL remains available for local development against a separate API.
export const apiBaseUrl = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL || '/api/v1')
  : '/api/v1';

export const publicVerificationBaseUrl = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '').replace(/\/$/, '')
  : '/api/public';
