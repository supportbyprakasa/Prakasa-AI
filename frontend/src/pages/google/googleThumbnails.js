import api from '../../api/client';

// Drive thumbnails are only served to a signed-in Google user, so the backend
// proxies them with the user's own delegated token. They are fetched as blobs
// (the API needs our Bearer token), at most 4 at a time, and cached for the
// session keyed by id + modifiedTime so an edited file gets a fresh preview.
const MAX_CONCURRENT = 4;
const MAX_CACHED = 300;
const cache = new Map(); // key -> object URL | null
const pending = new Map(); // key -> Promise
const queue = [];
let active = 0;

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const { task, resolve } = queue.shift();
    active += 1;
    task().then(resolve, () => resolve(null)).finally(() => { active -= 1; pump(); });
  }
}

function remember(key, url) {
  cache.set(key, url);
  if (cache.size > MAX_CACHED) {
    const [oldestKey, oldestUrl] = cache.entries().next().value;
    cache.delete(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
  }
}

export function thumbnailKey(file) {
  return `${file.id}:${file.modifiedTime || ''}`;
}

export function cachedThumbnail(file) {
  const key = thumbnailKey(file);
  return cache.has(key) ? cache.get(key) : undefined;
}

export function loadThumbnail(file) {
  const key = thumbnailKey(file);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (!pending.has(key)) {
    const promise = new Promise((resolve) => {
      queue.push({
        task: () => api.get(`/google-docs/files/${encodeURIComponent(file.id)}/thumbnail`, { responseType: 'blob' })
          .then((response) => URL.createObjectURL(response.data)),
        resolve,
      });
      pump();
    }).then((url) => {
      remember(key, url || null);
      pending.delete(key);
      return url || null;
    });
    pending.set(key, promise);
  }
  return pending.get(key);
}
