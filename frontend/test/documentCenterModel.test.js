import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoogleEditUrl, getGooglePreviewUrl } from '../src/pages/documents/documentCenterModel.js';

test('getGoogleEditUrl picks the right editor for native and Office mime types', () => {
  assert.equal(getGoogleEditUrl('abc', 'application/vnd.google-apps.document'), 'https://docs.google.com/document/d/abc/edit?usp=drivesdk');
  assert.equal(getGoogleEditUrl('abc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'https://docs.google.com/document/d/abc/edit?usp=drivesdk');
  assert.equal(getGoogleEditUrl('abc', 'application/vnd.google-apps.spreadsheet'), 'https://docs.google.com/spreadsheets/d/abc/edit?usp=drivesdk');
  assert.equal(getGoogleEditUrl('abc', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'https://docs.google.com/spreadsheets/d/abc/edit?usp=drivesdk');
  assert.equal(getGoogleEditUrl('abc', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'https://docs.google.com/presentation/d/abc/edit?usp=drivesdk');
  assert.equal(getGoogleEditUrl('abc', 'application/msword'), 'https://docs.google.com/document/d/abc/edit?usp=drivesdk');
  assert.equal(getGoogleEditUrl('abc', 'application/vnd.ms-excel'), 'https://docs.google.com/spreadsheets/d/abc/edit?usp=drivesdk');
});

test('getGoogleEditUrl returns null for types Google cannot edit inline, or a missing file id', () => {
  assert.equal(getGoogleEditUrl('abc', 'application/pdf'), null);
  assert.equal(getGoogleEditUrl('abc', 'image/png'), null);
  assert.equal(getGoogleEditUrl(null, 'application/vnd.google-apps.document'), null);
  assert.equal(getGoogleEditUrl('abc', undefined), null);
});

test('getGooglePreviewUrl derives a /preview URL only from a recognized Drive link', () => {
  assert.equal(getGooglePreviewUrl('https://drive.google.com/file/d/xyz/view'), 'https://drive.google.com/file/d/xyz/preview');
  assert.equal(getGooglePreviewUrl('https://docs.google.com/document/d/xyz/edit'), 'https://docs.google.com/document/d/xyz/preview');
  assert.equal(getGooglePreviewUrl('https://example.com/not-drive'), null);
  assert.equal(getGooglePreviewUrl(''), null);
  assert.equal(getGooglePreviewUrl(undefined), null);
});

import { FOLDER_MIME, fileKindIcon, groupDriveFiles } from '../src/pages/documents/documentCenterModel.js';

const DOC = { id: 'd', mimeType: 'application/vnd.google-apps.document' };
const SHEET = { id: 's', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const PDF = { id: 'p', mimeType: 'application/pdf' };
const FOLDER = { id: 'f', mimeType: FOLDER_MIME };

test('groupDriveFiles keeps the Drive order and leaves empty groups out', () => {
  const groups = groupDriveFiles([PDF, SHEET, DOC]);
  assert.deepEqual(groups.map((group) => group.kind), ['document', 'spreadsheet', 'other']);
  assert.deepEqual(groups.map((group) => group.files.map((file) => file.id)), [['d'], ['s'], ['p']]);
  assert.deepEqual(groupDriveFiles([]), []);
  assert.deepEqual(groupDriveFiles(undefined), []);
});

test('groupDriveFiles puts folders first only when asked', () => {
  assert.deepEqual(groupDriveFiles([DOC, FOLDER], { folders: true }).map((group) => group.kind), ['folder', 'document']);
  // Penyimpanan divisi opens a folder like any other file: it counts as "Lainnya".
  assert.deepEqual(groupDriveFiles([DOC, FOLDER]).map((group) => group.kind), ['document', 'other']);
});

test('fileKindIcon picks the Material Symbol for each kind', () => {
  assert.equal(fileKindIcon(FOLDER), 'folder');
  assert.equal(fileKindIcon(DOC), 'description');
  assert.equal(fileKindIcon(SHEET), 'table_chart');
  assert.equal(fileKindIcon({ mimeType: 'application/vnd.google-apps.presentation' }), 'slideshow');
  assert.equal(fileKindIcon(PDF), 'draft');
  assert.equal(fileKindIcon(undefined), 'draft');
});
