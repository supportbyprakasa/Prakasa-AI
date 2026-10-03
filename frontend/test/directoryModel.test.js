import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PERSON_KIND_LABELS, PERSON_STATUS_LABELS, RESIGN_SOURCE_LABELS, directoryQuery, entryLabel, isDuplicateName,
  managerOptions, orgForest, countTree, personBody, personFieldErrorFromApi, personFormErrors, personFormValues,
  personMarks, personStatusKey, unreviewedNote, personDateMarks, shortDate, runningWorkflowLabel,
} from '../src/pages/people/directoryModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

// People & Culture wave 1, row 1.1 (docs/rancangan-people-culture-g1.md rules 5–11).
const backend = createRequire(import.meta.url)('../../backend/src/config/itAssets.js');

test('directory labels are the backend\'s', () => {
  assert.deepEqual(PERSON_KIND_LABELS, { ...backend.PERSON_KIND_LABELS });
  assert.deepEqual(PERSON_STATUS_LABELS, { ...backend.PERSON_STATUS_LABELS });
  assert.deepEqual(RESIGN_SOURCE_LABELS, { ...backend.RESIGN_SOURCE_LABELS });
  assert.equal(statusLabel('no_account'), 'Tanpa akun');
  assert.equal(statusLabel('unreviewed'), 'Belum ditinjau');
  assert.equal(statusTone('unreviewed'), 'warning');
  assert.equal(statusLabel('person_resigned'), 'Resign');
});

test('list query: viewers never send the manage-only filters; People & Culture chips map to status/kind/reviewed', () => {
  assert.deepEqual(directoryQuery({ status: 'resigned', q: ' ani ', departmentId: '5', account: 'no', unreviewed: true }, false),
    { page: 1, limit: 50, q: 'ani', departmentId: '5', hasAccount: 'no' });
  assert.deepEqual(directoryQuery({ status: 'resigned' }, true), { page: 1, limit: 50, status: 'resigned' });
  assert.deepEqual(directoryQuery({ status: 'excluded', locationId: '1' }, true), { page: 1, limit: 50, locationId: '1', status: 'all', kind: 'excluded' });
  assert.deepEqual(directoryQuery({ status: 'active', unreviewed: true, page: 2 }, true), { page: 2, limit: 50, reviewed: 'no' });
  assert.deepEqual(directoryQuery({ status: 'bogus' }, true), { page: 1, limit: 50, status: 'active' });
});

test('marks and notes: "Tanpa akun", "Staf grup", "Belum ditinjau" only for People & Culture', () => {
  const account = { key: 'u9', hasAccount: true, groupStaff: false, reviewed: false };
  assert.deepEqual(personMarks(account, true), ['unreviewed']);
  assert.deepEqual(personMarks(account, false), [], 'viewers do not see review state');
  assert.deepEqual(personMarks({ hasAccount: false, groupStaff: true }, false), ['no_account', 'group_staff']);
  assert.equal(personStatusKey({ status: 'resigned', kind: 'employee' }), 'person_resigned');
  assert.equal(personStatusKey({ status: 'active', kind: 'excluded' }), 'person_excluded');
  assert.equal(unreviewedNote(12), '12 akun belum ditinjau People & Culture');
  assert.equal(unreviewedNote(0), '');
  assert.equal(entryLabel({ name: 'Ani', position: 'Admin Sales', departmentName: 'Sales' }), 'Ani — Admin Sales · Sales');
  assert.deepEqual(managerOptions([{ key: 'p1', name: 'A' }, { key: 'p2', name: 'B', position: 'Head' }], 'p1'), [{ value: 'p2', label: 'B — Head' }]);
});

test('form checks: name for people without an account, work email, phone, resign date, exclusion reason', () => {
  const base = personFormValues(null);
  assert.deepEqual(personFormErrors({ ...base }), { name: 'Nama wajib diisi' });
  assert.deepEqual(personFormErrors({ ...base }, { hasAccount: true }), {}, 'an account\'s name comes from Admin → Pengguna');
  assert.equal(personFormErrors({ ...base, name: 'A', workEmail: 'ani@gmail.com' }).workEmail, 'Email pribadi tidak boleh dipakai sebagai email kerja.');
  assert.equal(personFormErrors({ ...base, name: 'A', workEmail: 'ani@' }).workEmail, 'Format email kerja tidak valid');
  assert.equal(personFormErrors({ ...base, name: 'A', workEmail: 'ani@prakasafoods.com' }).workEmail, undefined);
  assert.equal(personFormErrors({ ...base, name: 'A', workPhone: '+62 21 555 1234 ext 12' }).workPhone, undefined);
  assert.ok(personFormErrors({ ...base, name: 'A', workPhone: 'call me' }).workPhone);
  assert.equal(personFormErrors({ ...base, name: 'A', status: 'resigned' }).resignedOn, 'Tanggal resign wajib diisi');
  assert.equal(personFormErrors({ ...base, name: 'A', status: 'resigned', resignedOn: '2026-09-30' }).resignedOn, undefined);
  assert.equal(personFormErrors({ ...base, name: 'A', kind: 'excluded' }).excludedReason, 'Alasan dikecualikan wajib diisi');
});

test('create body: a person without an account, empty fields left out', () => {
  const values = { ...personFormValues(null), name: ' Joko ', position: 'Sopir', managerKey: 'p4', locationId: '1', workEmail: '' };
  assert.deepEqual(personBody(values), { name: 'Joko', position: 'Sopir', managerKey: 'p4', locationId: 1, kind: 'employee', status: 'active' });
  assert.deepEqual(personBody({ ...values, status: 'resigned', resignedOn: '2026-09-30' }).resignedOn, '2026-09-30');
  assert.deepEqual(personBody({ ...values, kind: 'excluded', excludedReason: 'Akun uji' }).excludedReason, 'Akun uji');
});

test('edit body: only changes; account fields never sent; resign carries its date; reactivate sends the status alone', () => {
  const account = {
    key: 'u9', hasAccount: true, name: 'Ani', workEmail: 'ani@prakasafoods.com', departmentId: 5, position: 'Admin',
    managerKey: null, kind: 'employee', status: 'active', resignedOn: null, notes: null,
  };
  const values = personFormValues(account);
  assert.deepEqual(personBody({ ...values, name: 'Other', workEmail: 'x@prakasafoods.com', departmentId: '6', position: 'Admin Sales', managerKey: 'p4' }, account),
    { position: 'Admin Sales', managerKey: 'p4' });
  assert.deepEqual(personBody({ ...values, status: 'resigned', resignedOn: '2026-09-30' }, account), { status: 'resigned', resignedOn: '2026-09-30' });
  const resigned = { ...account, status: 'resigned', resignedOn: '2026-09-30' };
  assert.deepEqual(personBody({ ...personFormValues(resigned), status: 'active' }, resigned), { status: 'active' });
  assert.deepEqual(personBody({ ...personFormValues(resigned), resignedOn: '2026-09-29' }, resigned), { resignedOn: '2026-09-29', status: 'resigned' });
  assert.deepEqual(personBody({ ...values, kind: 'excluded', excludedReason: 'Akun uji' }, account), { kind: 'excluded', excludedReason: 'Akun uji' });
  const excluded = { ...account, kind: 'excluded', excludedReason: 'Akun uji' };
  assert.deepEqual(personBody({ ...personFormValues(excluded), kind: 'employee' }, excluded), { kind: 'employee', excludedReason: null });
  assert.deepEqual(personBody(values, account), {});
  const noAccount = { key: 'p45', hasAccount: false, name: 'Joko', workEmail: null, departmentId: null, status: 'active', kind: 'employee' };
  assert.deepEqual(personBody({ ...personFormValues(noAccount), workEmail: 'joko@prakasafoods.com', departmentId: '5' }, noAccount),
    { workEmail: 'joko@prakasafoods.com', departmentId: 5 });
});

test('server errors land on their field; NAME_EXISTS is a confirmation', () => {
  const err = (code, message, details) => ({ response: { data: { error: { code, message, details } } } });
  assert.deepEqual(personFieldErrorFromApi(err('WORK_EMAIL_DOMAIN', 'Email kerja harus memakai domain perusahaan: prakasagroup.com, prakasafoods.com')),
    { workEmail: 'Email kerja harus memakai domain perusahaan: prakasagroup.com, prakasafoods.com' });
  assert.deepEqual(personFieldErrorFromApi(err('MANAGER_CYCLE', 'Atasan ini melapor …')), { managerKey: 'Atasan ini melapor …' });
  assert.deepEqual(personFieldErrorFromApi(err('RESIGN_DATE_REQUIRED', 'Tanggal resign wajib diisi (YYYY-MM-DD)')), { resignedOn: 'Tanggal resign wajib diisi (YYYY-MM-DD)' });
  assert.deepEqual(personFieldErrorFromApi(err('VALIDATION_ERROR', 'Input tidak valid', { fieldErrors: { workPhone: ['Nomor telepon kerja tidak valid'] } })), { workPhone: 'Nomor telepon kerja tidak valid' });
  assert.equal(personFieldErrorFromApi(err('ACCOUNT_FIELDS', 'x')), null);
  assert.equal(isDuplicateName(err('NAME_EXISTS', 'Nama ini sudah ada')), true);
});

test('org chart: one indented tree per division by manager, never looping', () => {
  const org = {
    roots: ['p4', 'u9', 'p50'],
    nodes: [
      { key: 'p4', name: 'Budi', departmentName: 'Sales', childKeys: ['p12', 'p13'] },
      { key: 'p12', name: 'Ani', departmentName: 'Sales', childKeys: ['p4'] },
      { key: 'p13', name: 'Cici', departmentName: 'Sales', childKeys: [] },
      { key: 'u9', name: 'Dedi', departmentName: 'Finance', childKeys: [], managerOutside: true, managerName: 'Budi' },
      { key: 'p50', name: 'Eko', departmentName: null, childKeys: [] },
      { key: 'p60', name: 'Fani', departmentName: 'Finance', childKeys: [] },
    ],
  };
  const groups = orgForest(org);
  assert.deepEqual(groups.map((g) => [g.division, g.people]), [['Finance', 2], ['Sales', 3], ['Tanpa divisi', 1]]);
  const sales = groups[1].roots[0];
  assert.equal(sales.name, 'Budi');
  assert.deepEqual(sales.children.map((c) => c.name), ['Ani', 'Cici']);
  assert.deepEqual(sales.children[0].children, [], 'Ani → Budi again is not placed twice');
  assert.equal(countTree(sales), 3);
  assert.deepEqual(orgForest({ roots: [], nodes: [] }), []);
});

test('onboarding/offboarding dates beside a name: "Bergabung 12 Okt" / "Hari terakhir 15 Okt" (wave 2, row 2.1)', () => {
  const today = new Date(2026, 9, 1);
  assert.deepEqual(personDateMarks({ startsOn: '2026-10-12', lastDay: null }, today), [{ status: 'person_starting', label: 'Bergabung 12 Okt' }]);
  assert.deepEqual(personDateMarks({ startsOn: null, lastDay: '2026-10-15' }, today), [{ status: 'person_last_day', label: 'Hari terakhir 15 Okt' }]);
  assert.deepEqual(personDateMarks({ name: 'Ani' }, today), []);
  assert.equal(shortDate('2027-01-05', today), '5 Jan 2027', 'another year keeps the year');
  assert.equal(shortDate(null, today), '');
  assert.equal(statusTone('person_starting'), 'info');
  assert.equal(runningWorkflowLabel({ workflowType: 'offboarding', workflowNumber: 'OFB-2026-002' }), 'Offboarding OFB-2026-002');
  assert.equal(runningWorkflowLabel(null), '');
});
