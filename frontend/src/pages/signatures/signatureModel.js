// Display helpers for the signature pages. Pure: the pages and tests import it.

export const SIGNATURE_LEVEL_LABELS = { level_1: 'Level 1', level_2: 'Level 2' };

// Who must sign: a named user or role, else the bare account/role number.
export function assignedSignerLabel(row) {
  if (!row) return '';
  return row.assignedSignerUserName
    || row.assignedSignerRoleName
    || (row.assignedSignerUserId ? `Pengguna #${row.assignedSignerUserId}` : '')
    || (row.assignedSignerRoleId ? `Peran #${row.assignedSignerRoleId}` : '');
}

// Who actually signed.
export function signedByLabel(row) {
  if (!row) return '';
  return row.signedByName || (row.signedBy ? `Pengguna #${row.signedBy}` : '');
}

// Image files for a signature or letterhead: PNG/JPEG up to 500 KB. Returns
// the problem to show on the field, or '' when the file is fine.
export const IMAGE_MAX_BYTES = 500 * 1024;
export function imageFileError(file) {
  if (!file) return '';
  if (file.size > IMAGE_MAX_BYTES) return 'Ukuran file maksimum 500 KB.';
  return '';
}
