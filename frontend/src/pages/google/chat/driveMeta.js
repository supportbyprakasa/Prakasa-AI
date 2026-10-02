import { useEffect, useState } from 'react';
import api from '../../../api/client';
import { isDriveFileId } from '../chatModel';

// Names and types of Drive files linked in messages, fetched as the user in
// small batches and cached for the tab's lifetime (fileId → meta). A file the
// user can't open comes back { accessible:false }.
const cache = new Map();
const listeners = new Set();
let queue = new Set();
let timer = null;

function flush() {
  timer = null;
  const ids = [...queue].slice(0, 50);
  queue = new Set([...queue].slice(50));
  if (queue.size) timer = setTimeout(flush, 0);
  if (!ids.length) return;
  api.get('/google-chat/drive/meta', { params: { ids: ids.join(',') } })
    .then((response) => {
      for (const file of response.data.data.files || []) cache.set(file.id, file);
    })
    .catch(() => {
      for (const id of ids) cache.set(id, { id, accessible: false, failed: true });
    })
    .finally(() => listeners.forEach((fn) => fn()));
}

export function requestDriveMeta(ids) {
  let added = false;
  for (const id of ids) {
    if (!isDriveFileId(id) || cache.has(id) || queue.has(id)) continue;
    queue.add(id);
    added = true;
  }
  if (added && !timer) timer = setTimeout(flush, 60);
}

export function rememberDriveMeta(files) {
  for (const file of files || []) if (file?.id) cache.set(file.id, { ...file, accessible: true });
  listeners.forEach((fn) => fn());
}

// → { [fileId]: meta } for the ids given (only the ones already known).
export function useDriveMeta(ids) {
  const key = [...new Set(ids)].filter(isDriveFileId).sort().join(',');
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    requestDriveMeta(key.split(','));
    return () => listeners.delete(listener);
  }, [key]);
  const out = {};
  for (const id of key ? key.split(',') : []) if (cache.has(id)) out[id] = cache.get(id);
  return out;
}
