import { resolveApiBaseUrl, resolvePublicVerificationBaseUrl } from './endpointModel';

// VITE_API_URL is baked in at build time (frontend/.env.production): in
// production it points at the API host, e.g. https://api.<domain>/api/v1.
const env = { dev: Boolean(import.meta.env.DEV), apiUrl: import.meta.env.VITE_API_URL };

export const apiBaseUrl = resolveApiBaseUrl(env);

export const publicVerificationBaseUrl = resolvePublicVerificationBaseUrl(env);
