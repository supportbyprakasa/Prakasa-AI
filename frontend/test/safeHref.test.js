import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeExternalHref, safeInAppPath } from '../src/components/safeHref.js';
import { safeInternalPath } from '../src/components/notifications/notificationModel.js';
import { allowedLink } from '../src/components/navigation.js';

// Security review (Oct 2026): stored URLs become links only for safe schemes,
// and in-app paths from data never leave the app.

test('safeExternalHref keeps https, http and mailto only', () => {
  assert.equal(safeExternalHref('https://app.kantorku.id/e/1'), 'https://app.kantorku.id/e/1');
  assert.equal(safeExternalHref('  http://example.com  '), 'http://example.com/');
  assert.equal(safeExternalHref('mailto:it@prakasagroup.com'), 'mailto:it@prakasagroup.com');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:msgbox', 'file:///etc/passwd', '/relative', '//evil.test', '', null, undefined, 42]) {
    assert.equal(safeExternalHref(bad), null, String(bad));
  }
});

test('in-app paths reject protocol-relative, backslash and control-character forms', () => {
  assert.equal(safeInAppPath('/tasks/12?tab=a#b'), '/tasks/12?tab=a#b');
  for (const bad of ['//evil.test', '/\\evil.test', '/\\/evil.test', '\\\\evil.test', '/a\\b', '/a\nb', 'https://evil.test', 'tasks', '', null]) {
    assert.equal(safeInAppPath(bad), null, String(bad));
  }
  assert.equal(safeInternalPath('/\\evil.test'), null);
  assert.equal(safeInternalPath('/notifications'), '/notifications');
  assert.equal(allowedLink('/\\evil.test', []), null);
  assert.equal(allowedLink('/', []), '/');
});

test('the navbar, AI inbox and KantorKu link use the guards', () => {
  const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.match(read('components/Navbar.jsx'), /to=\{safeInAppPath\(item\.actionUrl\) \|\| '\/notifications'\}/);
  assert.match(read('components/ai/AIInbox.jsx'), /const isInternalUrl = \(url\) => Boolean\(safeInAppPath\(url\)\)/);
  const hrga = read('pages/hrga/HrgaWorkflowDetail.jsx');
  assert.match(hrga, /href=\{safeExternalHref\(wf\.kantorkuReferenceUrl\)\}/);
  assert.doesNotMatch(hrga, /href=\{wf\.kantorkuReferenceUrl\}/);
});
