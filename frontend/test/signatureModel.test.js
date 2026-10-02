import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MAX_BYTES, assignedSignerLabel, imageFileError, signedByLabel } from '../src/pages/signatures/signatureModel.js';

test('the assigned signer is a name when known, else the account or role number', () => {
  assert.equal(assignedSignerLabel({ assignedSignerUserName: 'Rina' }), 'Rina');
  assert.equal(assignedSignerLabel({ assignedSignerRoleName: 'Head Sales' }), 'Head Sales');
  assert.equal(assignedSignerLabel({ assignedSignerUserId: 7 }), 'Pengguna #7');
  assert.equal(assignedSignerLabel({ assignedSignerRoleId: 3 }), 'Peran #3');
  assert.equal(assignedSignerLabel({}), '');
  assert.equal(signedByLabel({ signedBy: 9 }), 'Pengguna #9');
  assert.equal(signedByLabel({ signedByName: 'Budi', signedBy: 9 }), 'Budi');
});

test('signature and letterhead images are limited to 500 KB, shown on the field', () => {
  assert.equal(imageFileError({ size: IMAGE_MAX_BYTES }), '');
  assert.equal(imageFileError({ size: IMAGE_MAX_BYTES + 1 }), 'Ukuran file maksimum 500 KB.');
  assert.equal(imageFileError(null), '');
});
