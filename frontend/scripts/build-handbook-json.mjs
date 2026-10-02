// Writes the Panduan (in-app handbook) as data for the backend, so Prakasa AI's
// `panduan_aplikasi` tool answers from the same text as the page without a
// hand-kept copy: backend/src/config/handbook.generated.json.
//
//   cd frontend && node scripts/build-handbook-json.mjs          write the file
//   cd frontend && node scripts/build-handbook-json.mjs --check  exit 1 when it is stale
//
// The text comes from src/pages/handbook/handbookContent.js. The page's rule
// "a section about a page the menu would refuse is hidden" (hasRouteAccess,
// components/navigation.js) is carried over as `routeAccess`: for every route
// the content names, the permissions that open it (any of), `open` when no
// permission is needed, or `blocked`. backend/src/services/handbookAccess.js
// applies it with the same audience rules as handbookModel.visibleChapters;
// tests on both sides fail when this file is stale or the two filters differ.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import HANDBOOK from '../src/pages/handbook/handbookContent.js';
import { contentRoutes } from '../src/pages/handbook/handbookModel.js';
import { hasRouteAccess } from '../src/components/navigation.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { STANDARD_ROLES, SYSTEM_ADMIN_PERMISSIONS } = require('../../backend/src/config/standardOrganization.js');
export const OUT = join(here, '../../backend/src/config/handbook.generated.json');

const navSource = readFileSync(join(here, '../src/components/navigation.js'), 'utf8');
// Every permission code anywhere: the standard roles, the admin role and the menu.
const ALL_PERMISSIONS = [...new Set([
  ...STANDARD_ROLES.flatMap((role) => role.permissions),
  ...SYSTEM_ADMIN_PERMISSIONS,
  ...[...navSource.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]),
])].sort();

const pathOf = (route) => String(route).split(/[?#]/)[0];

// hasRouteAccess is "any of the entry's permissions", so the single
// permissions that open a route are exactly its any-of list.
function accessOf(route) {
  const path = pathOf(route);
  if (hasRouteAccess(path, [])) return { open: true };
  const anyOf = ALL_PERMISSIONS.filter((code) => hasRouteAccess(path, [code]));
  return anyOf.length ? { anyOf } : { blocked: true };
}

// The hash both stale tests compare: the content as data (comments and
// formatting of the source file do not count).
export const contentHash = (content) => createHash('sha256').update(JSON.stringify(content)).digest('hex');

export function buildHandbookJson(content = HANDBOOK) {
  const routes = [...new Set(contentRoutes(content).map((entry) => pathOf(entry.route)))].sort();
  return {
    note: 'Dibuat oleh frontend/scripts/build-handbook-json.mjs dari frontend/src/pages/handbook/handbookContent.js. Jangan diubah dengan tangan.',
    sourceHash: contentHash(content),
    routeAccess: Object.fromEntries(routes.map((route) => [route, accessOf(route)])),
    chapters: content.map((chapter) => ({
      id: chapter.id,
      part: chapter.part || null,
      title: chapter.title,
      scope: chapter.scope || 'general',
      audience: chapter.audience || null,
      route: chapter.route || null,
      who: chapter.who || null,
      summary: chapter.summary || null,
      sections: (chapter.sections || []).map((section) => ({
        id: section.id,
        title: section.title,
        audience: section.audience || null,
        route: section.route || null,
        body: section.body || [],
      })),
    })),
  };
}

export const serialize = (data) => `${JSON.stringify(data, null, 1)}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = serialize(buildHandbookJson());
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch { current = ''; }
    if (current !== next) {
      console.error('backend/src/config/handbook.generated.json sudah usang. Jalankan: cd frontend && node scripts/build-handbook-json.mjs');
      process.exit(1);
    }
    console.log('handbook.generated.json sesuai dengan handbookContent.js');
  } else {
    writeFileSync(OUT, next);
    const data = JSON.parse(next);
    console.log(`handbook.generated.json: ${data.chapters.length} bab, ${data.chapters.reduce((n, c) => n + c.sections.length, 0)} bagian, ${Object.keys(data.routeAccess).length} rute`);
  }
}
