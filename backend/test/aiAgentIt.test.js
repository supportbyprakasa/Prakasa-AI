// Prakasa AI reads IT data (Wave B): tickets, IT dashboard, devices, software
// subscriptions and the infrastructure registers. The tools run against the
// real controllers/services with a mocked pool (no database, no writes, no
// notifications).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = '../src';
const pool = require(`${B}/db/pool`);
const notif = require(`${B}/services/notification.service`);
const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const contract = require(`${B}/services/ai/agent/toolContract`);
const { MONEY_KEY, PERSONAL_KEY } = require(`${B}/services/ai/agent/outputGuard`);
const registry = require(`${B}/services/aiToolRegistry.service`);

const NAMES = ['tiket_it', 'ringkasan_it', 'perangkat_saya', 'perangkat_it', 'langganan_software', 'biaya_langganan_software', 'infrastruktur_it'];
const PAGE_KEYS = ['it-tickets', 'it-dashboard', 'devices', 'subscriptions', 'it-infrastructure'];
const tool = (name) => agentTools.byName.get(name);
const itTools = () => agentTools.TOOLS.filter((t) => t.file === 'it.js');

const MONEY = 987654321;
const DAY = 86400e3;
const date = (offsetDays) => new Date(Math.floor(Date.now() / DAY) * DAY + offsetDays * DAY);
// One row carrying every column the IT reads use, plus bait that must never come out.
const ROW = {
  id: 5, entity_id: 7, department_id: 3, total: 1, n: 1, version: 1,
  // tickets
  category: 'network', title: 'Wifi lantai 2 putus', description: 'Sering putus sejak pagi', priority: 'high', status: 'active',
  device_id: 5, deviceId: 5, deviceAssetCode: 'AST-001', deviceType: 'laptop', deviceBrand: 'Lenovo', deviceModel: 'T14',
  requester_id: 42, requesterId: 42, requesterName: 'Uji Pengaju', requesterEmail: 'sentinel@uji.invalid',
  createdAt: date(-9), updatedAt: date(-1), created_at: date(-9), updated_at: date(-1), resolved_at: null, closed_at: null, cancelled_at: null,
  tracker_issue_id: null, body: 'Sudah dicek', authorId: 8, authorName: 'Uji IT',
  driveFileId: 'DRIVE-SENTINEL', webViewLink: 'https://drive.sentinel/file', name: 'foto.png', mimeType: 'image/png', size: 10, uploadedBy: 42,
  // devices
  asset_code: 'AST-001', assetCode: 'AST-001', device_type: 'laptop', brand: 'Lenovo', model: 'T14', serial_number: 'SN-DEVICE-1', serialNumber: 'SN-DEVICE-1',
  ram_gb: 16, storage_gb: 512, os_version: 'Windows 11', purchase_year: 2024, purchase_date: date(-400), status_changed_at: date(-30),
  condition_state: 'good', current_assignee_id: 42, holder_person_id: null, holder_label: null, location_id: 2, location_name: 'Kantor Uji',
  current_location: null, warranty_end: date(20), warrantyEnd: date(20), daysLeft: 20, warranty_start: date(-345), warranty_type: 'manufacturer',
  holder_kind: 'user', holder_name: 'Uji Pemegang', holder_row_id: 11, holder_resigned: 1, active_assignment_id: 4,
  imei: 'IMEI-SENTINEL', mac_address: 'AA:BB:CC:SENTINEL', purchase_price: MONEY, currency: 'IDR', supplier: 'PT SENTINEL Pemasok', invoice_document_id: 9,
  notes: 'CATATAN-SENTINEL pin 1234',
  assignedTo: 42, personId: null, holderLabel: null, holderName: 'Uji Pemegang', assignedToName: 'Uji Pemegang', assignedBy: 8, assignedAt: date(-60),
  expectedReturnDate: date(-10), actualReturnDate: null, location: 'Kantor Uji', purpose: 'Kerja harian',
  maintenanceDate: date(-50), maintenanceType: 'preventive', performedBy: 'Vendor', cost: MONEY, nextMaintenanceDate: date(40),
  reportedDate: date(-70), issueDescription: 'Layar bergaris', severity: 'medium', vendorName: 'Vendor Uji', sentDate: date(-69), returnedDate: date(-60), resolution: 'Ganti panel',
  warrantyType: 'manufacturer', startDate: date(-345), endDate: date(20), provider: 'Operator Uji', claimNumber: 'CLAIM-SENTINEL',
  // dashboard
  available: 1, assigned: 1, maintenance: 0, repair: 0, damaged: 1, retired: 0, lost: 0, disposed: 0, problematic: 1, without_asset_code: 0,
  warranty_ending: 1, resigned_holder: 1, active: 1, expiring: 1, expired: 0, totalSeats: 10, productName: 'Produk Uji', renewalDate: date(12),
  invoiceNumber: 'INV-SENTINEL', invoiceDate: date(-3), headcount: 10, unreviewedAccounts: 0, groupStaff: 0, withoutAccount: 0,
  // subscriptions
  product_name: 'Produk Uji', plan_name: 'Business', planName: 'Business', license_type: 'per_user', licenseType: 'per_user',
  billing_cycle: 'monthly', billingCycle: 'monthly', total_seats: 10, unit_price: MONEY, unitPrice: MONEY, start_date: date(-200), renewal_date: date(12),
  auto_renew: 1, autoRenew: 1, picUserId: 8, picName: 'Uji PIC', vendorId: 2, jurnal_reference_id: 'JURNAL-SENTINEL',
  assignedSeats: 6, availableSeats: 2, idleSeats: 2, hasLicenseKey: 1, license_key: 'KEY-SENTINEL', seatLabel: 'Kursi 1', lastUsedAt: date(-40),
  amount: MONEY, totalAmount: MONEY, referenceNo: 'REF-SENTINEL', paymentMethod: 'transfer', proposedAmount: MONEY, proposedSeats: 12,
  requestDate: date(-2), proposedRenewalDate: date(377), currentRenewalDate: date(12), decidedAt: null, paidAt: date(-3),
  // infrastructure
  brand_model: 'MikroTik MODEL-SENTINEL', ip_address: '10.99.88.77', installed_year: 2023, isp_link_id: 1, isp_name: 'ISP Uji',
  firmware_updated_on: date(-300), vendor_id: 2, vendor_name: 'Vendor Uji', provider_name: 'ISP Uji', customer_number: 'CUST-SENTINEL',
  bandwidth_mbps: 100, public_ip_dedicated: 1, is_backup: 0, contract_start: date(-300), contract_end: date(25), monthly_cost: MONEY,
  camera_count: 8, camera_model: 'CAM-SENTINEL', recorder_type: 'nvr', recorder_device_id: 1, recorder_name: 'NVR MODEL-SENTINEL', recorder_device_type: 'nvr',
  remote_access: 1, same_network_as_pc: 1, cameras_offline: 2,
  data_scope: 'File keuangan', method: 'METODE-SENTINEL rsync ke nas', frequency: 'weekly', storage_location: 'offsite', retention: '30 hari',
  restore_tested_on: null, last_checked_on: date(-40), last_result: 'failed', due_on: date(-30), overdue: 1, check_count: 3,
  kind: 'mobile', number: '+62811000111', extension: '101', person_id: 11, person_name: 'Uji Pemegang', person_status: 'resigned',
  device_brand: 'Samsung', device_model: 'A15', device_asset_code: 'AST-002', plan_name_phone: 'x', started_on: date(-100),
  reviewed_on: date(-120), active_users: 40, super_admins: 3, mfa_enforced: 0, external_sharing_restricted: 0, shared_accounts_used: 1,
  ex_users_active: 2, reviewed_by_name: 'Uji IT',
  systems: 1, cameras: 8, not_online: 1, primary_mbps: 100, without_backup: 1, contracts_ending: 1, failing: 1, restore_untested: 1, spare: 0, infra: 1,
  // more bait
  password: 'PASS-SENTINEL', wifi_password: 'WIFI-SENTINEL', portal_url: 'https://portal.sentinel', username: 'admin-sentinel',
};
const BAIT = /SENTINEL|sentinel|10\.99\.88\.77|pin 1234/;
// Key names that must never appear in an IT tool result (infra rule: nothing that helps an attacker).
const ATTACK_KEY = /(^|_)(ip|ipv4|ipv6|alamat_ip|ip_address|mac|imei|serial|seri|firmware|password|kata_sandi|sandi|wifi|ssid|kredensial|credential|login|username|user_name|url|portal|tautan|link|kunci|key|token|secret|pelanggan|customer|catatan_register|notes|remote|akses_jarak_jauh|metode|method)($|_)/i;

function keysOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, out));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) { out.push(key); keysOf(child, out); }
  }
  return out;
}

function mockDb(t, { rows = 1, row = ROW } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    calls.push({ sql: String(sql), args });
    return [Array.from({ length: rows }, (_, i) => ({ ...row, ...(rows > 1 ? { id: i + 1 } : {}) }))];
  });
  t.mock.method(pool, 'getConnection', async () => { throw new Error('an IT read tool must not open a transaction'); });
  t.mock.method(notif, 'create', async () => { throw new Error('an IT read tool must not notify'); });
  return calls;
}

const ALL = [...new Set(STANDARD_ROLES.flatMap((r) => r.permissions))];
const admin = { sub: 8, entityId: 7, departmentId: 3, permissions: ALL };
const INPUTS = {
  tiket_it: [{}, { status: 'semua', cari: 'wifi', kategori: 'jaringan', prioritas: 'tinggi', jumlah: 5 }, { umur_minimal_hari: 3 }, { lingkup: 'milik_saya' }, { id_tiket: 5 }],
  ringkasan_it: [{}],
  perangkat_saya: [{}],
  perangkat_it: [{}, { cari: 'AST', status: 'aktif', jenis: 'laptop' }, { saring: 'garansi_segera_habis' }, { saring: 'belum_dikembalikan' }, { saring: 'pemegang_resign' }, { saring: 'bermasalah', garansi_dalam_hari: 30 }, { id_perangkat: 5 }],
  langganan_software: [{}, { cari: 'produk', status: 'aktif' }, { perpanjangan_dalam_hari: 30 }, { hanya_lisensi_menganggur: true }, { pemegang: 'uji' }, { id_langganan: 5 }],
  biaya_langganan_software: [{}, { cari: 'produk', status: 'aktif', jumlah: 5 }],
  infrastruktur_it: [{}, { register: 'ringkasan' }, { register: 'jaringan' }, { register: 'isp', hanya_perlu_ditindak: true }, { register: 'cctv', lokasi: 'kantor' }, { register: 'backup' }, { register: 'google_workspace' }, { register: 'nomor_perusahaan' }],
};

test('the IT tools exist, pass the contract and serve the five IT pages', () => {
  const tools = itTools();
  assert.deepEqual(tools.map((t) => t.name), NAMES);
  const moduleKeys = new Set(registry.TOOLS.map((entry) => entry.key));
  assert.deepEqual(contract.validateTools(tools, { moduleKeys }), []);
  const served = new Set(tools.flatMap((t) => t.module));
  for (const key of PAGE_KEYS) assert.ok(served.has(key), key);
  for (const t of tools) {
    assert.equal(t.privateOnly, true, `${t.name} reads division data: private conversations only`);
    assert.equal(t.public, undefined, t.name);
    assert.match(t.description, contract.NOT_RETURNED, t.name);
  }
  assert.deepEqual(tools.filter((t) => t.money).map((t) => t.name), ['biaya_langganan_software']);
  // The same permission as each page.
  assert.equal(tool('tiket_it').permission, 'it_ticket.view');
  assert.equal(tool('ringkasan_it').permission, 'it.dashboard.view');
  assert.equal(tool('perangkat_it').permission, 'device.view');
  assert.equal(tool('langganan_software').permission, 'subscription.view');
  assert.equal(tool('infrastruktur_it').permission, 'it.infra.view');
  for (const key of PAGE_KEYS) {
    const page = registry.TOOLS.find((entry) => entry.key === key);
    assert.ok(page, key);
  }
});

test('the infrastructure tool says what it never returns: IP, credentials, portal, Wi-Fi', () => {
  const d = tool('infrastruktur_it').description;
  for (const word of [/alamat IP/i, /kredensial/i, /portal/i, /Wi-Fi/i, /nomor seri/i, /nomor pelanggan/i, /catatan register/i, /biaya/i]) assert.match(d, word);
  assert.match(d, /Tidak pernah/);
  const code = fs.readFileSync(path.join(__dirname, '../src/services/ai/agent/tools/it.js'), 'utf8');
  // No field of a row that carries an address, an identifier of network gear, a secret or a cost is ever read.
  assert.doesNotMatch(code, /\.(ipAddress|macAddress|imei|customerNumber|publicIpDedicated|remoteAccess|sameNetworkAsPc|brandModel|firmwareUpdatedOn|cameraModel|recorderName|storageLocation\w*|method|monthlyCost|notes|purchasePrice|supplier|webViewLink|driveFileId|requesterEmail|hasLicenseKey|license_key|referenceNo|invoiceNumber|claimNumber)\b/);
  assert.doesNotMatch(code, /db\/pool/);
  assert.doesNotMatch(code, /\b(create|update|remove|returnDevice|setStatus|addComment|updateStatus|createTicket|saveSupportSettings|cctvStatus|addBackupCheck|addGwsReview|phoneHolder|importApply|aiReport|exportRows)\b\s*[,(]/, 'only read handlers are called');
});

test('without the permission every IT tool refuses; costs need the managing permission AND the page permission', async (t) => {
  const calls = mockDb(t);
  for (const name of NAMES) {
    await assert.rejects(tool(name).run({ sub: 1, entityId: 7, permissions: [] }, {}), (e) => e.status === 403 && e.code === 'FORBIDDEN', name);
    await assert.rejects(tool(name).run({ sub: 1, entityId: 7, permissions: ['task.view', 'sales.view'] }, {}), (e) => e.status === 403, name);
  }
  const biaya = tool('biaya_langganan_software');
  await assert.rejects(biaya.run({ sub: 1, entityId: 7, permissions: ['subscription.view'] }, {}), (e) => e.status === 403, 'viewing is not enough for rupiah');
  await assert.rejects(biaya.run({ sub: 1, entityId: 7, permissions: ['subscription.manage'] }, {}), (e) => e.status === 403, 'the page permission is needed too');
  assert.equal(calls.length, 0, 'a refusal reads nothing');
  const out = await biaya.run({ sub: 1, entityId: 7, permissions: ['subscription.view', 'subscription.manage'] }, {});
  assert.equal(out.langganan[0].harga_satuan, MONEY);
});

test('role matrix: every employee has tickets and own devices; IT registers only People & Culture; costs only its Supervisor/Head', () => {
  const session = { visibility: 'private' };
  for (const role of STANDARD_ROLES) {
    const names = agentTools.toolsFor({ permissions: [...role.permissions] }, session).map((t) => t.name).filter((n) => NAMES.includes(n));
    const perms = role.permissions;
    const expected = NAMES.filter((name) => [].concat(tool(name).permission).some((code) => perms.includes(code)));
    assert.deepEqual(names, expected, role.key);
    if (role.departmentCode !== 'people_culture' && !perms.includes('it.infra.view')) {
      assert.ok(!names.includes('infrastruktur_it'), `${role.key} must not read the infrastructure registers`);
    }
    if (!perms.includes('device.view')) assert.ok(!names.includes('perangkat_it'), role.key);
    if (!perms.includes('subscription.view')) assert.ok(!names.includes('langganan_software'), role.key);
    if (!['subscription.manage', 'subscription.invoice.manage', 'subscription.payment.manage'].some((p) => perms.includes(p))) {
      assert.ok(!names.includes('biaya_langganan_software'), `${role.key} must not read subscription costs`);
    }
  }
  const member = STANDARD_ROLES.find((r) => r.departmentCode === 'people_culture' && /member/.test(r.key));
  if (member) {
    const names = agentTools.toolsFor({ permissions: [...member.permissions] }, session).map((t) => t.name);
    assert.ok(names.includes('langganan_software'));
    assert.ok(!names.includes('biaya_langganan_software'), 'a People & Culture member sees licences, not rupiah');
  }
});

test('no IT tool in a shared conversation or next to web research', () => {
  for (const s of [{ visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }, null]) {
    const names = agentTools.toolsFor(admin, s).map((t) => t.name);
    assert.deepEqual(names.filter((n) => NAMES.includes(n)), [], JSON.stringify(s));
  }
  const names = agentTools.toolsFor(admin, { visibility: 'private' }).map((t) => t.name);
  for (const name of NAMES) assert.ok(names.includes(name), name);
});

test('tickets: an employee reads only tickets they filed; IT reads the whole company, or only its own on request', async (t) => {
  const calls = mockDb(t, { row: { ...ROW, status: 'open' } });
  const listSql = () => calls.filter((c) => /FROM it_tickets t/.test(c.sql));
  const member = { sub: 42, entityId: 7, permissions: ['it_ticket.view', 'it_ticket.create'] };

  const own = await tool('tiket_it').run(member, {});
  assert.equal(own.lingkup, 'tiket yang Anda ajukan');
  assert.ok(listSql().length >= 3);
  for (const c of listSql()) {
    assert.match(c.sql, /t\.requester_id = \?/, 'bound to the requester');
    assert.deepEqual(c.args.slice(0, 2), [7, 42], 'company and requester');
  }
  assert.equal('pengaju' in own.tiket[0], false);
  assert.match(own.catatan, /Anda hanya melihat tiket yang Anda ajukan sendiri/);
  // "lingkup: semua" does not widen a member's view.
  calls.length = 0;
  await tool('tiket_it').run(member, { lingkup: 'semua', status: 'semua' });
  for (const c of listSql()) assert.match(c.sql, /t\.requester_id = \?/);

  calls.length = 0;
  const manager = { sub: 8, entityId: 7, permissions: ['it_ticket.view', 'it_ticket.manage'] };
  const all = await tool('tiket_it').run(manager, {});
  assert.equal(all.lingkup, 'semua tiket perusahaan');
  for (const c of listSql()) {
    assert.doesNotMatch(c.sql, /t\.requester_id = \?/);
    assert.equal(c.args[0], 7, 'still the user\'s company');
  }
  assert.equal(all.tiket[0].pengaju, 'Uji Pengaju');
  assert.equal(all.tiket[0].rute, '/it/tickets/5');
  assert.ok(all.tiket[0].umur_hari >= 8);
  assert.equal(all.belum_selesai.lebih_dari_7_hari, 3);
  assert.match(all.catatan, /SLA/);

  calls.length = 0;
  const mine = await tool('tiket_it').run(manager, { lingkup: 'milik_saya' });
  assert.equal(mine.lingkup, 'tiket yang Anda ajukan');
  for (const c of listSql()) assert.match(c.sql, /t\.requester_id = \?/);
});

test('ticket detail: someone else\'s ticket is refused for an employee; another company\'s ticket is not found even for IT', async (t) => {
  mockDb(t);
  const detail = tool('tiket_it');
  const owner = { sub: 42, entityId: 7, permissions: ['it_ticket.view'] };
  const out = await detail.run(owner, { id_tiket: 5 });
  assert.equal(out.judul, 'Wifi lantai 2 putus');
  assert.equal(out.milik_anda, true);
  assert.equal(out.jumlah_lampiran, 1);
  assert.deepEqual(out.komentar[0].dari, 'Uji IT');
  assert.doesNotMatch(JSON.stringify(out), BAIT, 'no requester email, no attachment link');

  await assert.rejects(detail.run({ sub: 43, entityId: 7, permissions: ['it_ticket.view'] }, { id_tiket: 5 }), (e) => e.status === 403);
  const itOther = await detail.run({ sub: 8, entityId: 7, permissions: ['it_ticket.view', 'it_ticket.manage'] }, { id_tiket: 5 });
  assert.equal(itOther.milik_anda, false);
  await assert.rejects(detail.run({ sub: 8, entityId: 99, permissions: ['it_ticket.view', 'it_ticket.manage'] }, { id_tiket: 5 }), (e) => e.status === 404);
});

test('own devices are bound to the asking user; the inventory is bound to the user\'s company', async (t) => {
  const calls = mockDb(t);
  const mine = await tool('perangkat_saya').run({ sub: 42, entityId: 7, permissions: ['it_ticket.create'] }, {});
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /current_assignee_id=\?/);
  assert.deepEqual(calls[0].args, [42]);
  assert.deepEqual(mine.perangkat[0], { id: 5, nomor_aset: 'AST-001', jenis: 'laptop', merek_model: 'Lenovo T14' });

  calls.length = 0;
  const list = await tool('perangkat_it').run({ sub: 8, entityId: 7, permissions: ['device.view'] }, { cari: 'AST', status: 'aktif', saring: 'pemegang_resign' });
  for (const c of calls) assert.equal(c.args[0], 7, c.sql.slice(0, 60));
  assert.ok(calls.some((c) => /d\.status IN \(\?\)/.test(c.sql) && c.args.includes('assigned')));
  assert.equal(list.perangkat[0].pemegang, 'Uji Pemegang');
  assert.equal(list.perangkat[0].pemegang_sudah_resign, true);
  assert.equal(list.perangkat[0].rute, '/it/devices/5');

  calls.length = 0;
  const late = await tool('perangkat_it').run({ sub: 8, entityId: 7, permissions: ['device.view'] }, { saring: 'belum_dikembalikan' });
  assert.equal(late.jumlah_lewat_tanggal_kembali, 1);
  assert.equal(late.lewat_tanggal_kembali[0].terlambat_hari, 10);
  assert.equal(late.jumlah_dipegang_karyawan_resign, 1);
  for (const c of calls) assert.equal(c.args[0], 7);

  // A device of another company reads as not found (the page's own rule).
  pool.query.mock.mockImplementation(async () => [[]]);
  await assert.rejects(tool('perangkat_it').run({ sub: 8, entityId: 7, permissions: ['device.view'] }, { id_perangkat: 5 }), (e) => e.status === 404);
  await assert.rejects(tool('langganan_software').run({ sub: 8, entityId: 7, permissions: ['subscription.view'] }, { id_langganan: 5 }), (e) => e.status === 404);
});

test('licences: who holds what, idle seats and renewals due — never a licence key or rupiah', async (t) => {
  mockDb(t);
  const user = { sub: 8, entityId: 7, permissions: ['subscription.view'] };
  const list = await tool('langganan_software').run(user, { perpanjangan_dalam_hari: 30, hanya_lisensi_menganggur: true });
  assert.equal(list.langganan[0].produk, 'Produk Uji');
  assert.equal(list.langganan[0].kursi_menganggur, 2);
  assert.equal(list.langganan[0].hari_sampai_perpanjangan, 12);
  assert.equal(list.jumlah_lisensi_menganggur, 2);
  const holder = await tool('langganan_software').run(user, { pemegang: 'pemegang' });
  assert.equal(holder.jumlah_lisensi, 1);
  assert.equal(holder.lisensi[0].pemegang, 'Uji Pemegang');
  const none = await tool('langganan_software').run(user, { pemegang: 'tidak ada orangnya' });
  assert.equal(none.jumlah_lisensi, 0);
  const detail = await tool('langganan_software').run(user, { id_langganan: 5 });
  assert.equal(detail.lisensi[0].kursi, 'Kursi 1');
  for (const out of [list, holder, detail]) {
    const json = JSON.stringify(out);
    assert.ok(!json.includes(String(MONEY)));
    assert.doesNotMatch(json, BAIT);
  }
});

test('nothing secret, personal or priced leaves any IT tool — even for a user holding every permission', async (t) => {
  const calls = mockDb(t);
  for (const name of NAMES) {
    const money = tool(name).money === true;
    for (const input of INPUTS[name]) {
      calls.length = 0;
      const out = await tool(name).run(admin, input);
      const label = `${name} ${JSON.stringify(input)}`;
      const json = JSON.stringify(out);
      assert.doesNotMatch(json, BAIT, `${label} leaked bait`);
      assert.ok(!json.includes('10.99.88.77'), `${label} leaked an IP address`);
      const keys = keysOf(out);
      assert.deepEqual(keys.filter((k) => PERSONAL_KEY.test(k)), [], label);
      // The one reviewed exception: the serial number in the detail of ONE device (device.view).
      const allowed = name === 'perangkat_it' && input.id_perangkat ? ['nomor_seri'] : [];
      assert.deepEqual(keys.filter((k) => ATTACK_KEY.test(k) && !allowed.includes(k)), [], label);
      if (!money) {
        assert.deepEqual(keys.filter((k) => MONEY_KEY.test(k)), [], label);
        assert.ok(!json.includes(String(MONEY)), `${label} leaked rupiah`);
        assert.ok(!/"IDR"/.test(json), `${label} leaked a currency`);
      }
      assert.ok(calls.length > 0, label);
      for (const { sql } of calls) assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `${label} ran a non-SELECT: ${sql.slice(0, 60)}`);
    }
  }
});

test('infrastructure: statuses and reviews due only — no address, model, firmware, customer number, method or note', async (t) => {
  const calls = mockDb(t);
  const user = { sub: 8, entityId: 7, permissions: ['it.infra.view'] };
  const run = (input) => tool('infrastruktur_it').run(user, input);

  const summary = await run({});
  assert.equal(summary.backup.gagal, 1);
  assert.equal(summary.isp.kontrak_berakhir_dalam_60_hari, 1);
  assert.equal(summary.rute, '/it/infrastructure');

  const network = await run({ register: 'jaringan' });
  assert.deepEqual(Object.keys(network.daftar[0]).sort(), ['id', 'jenis', 'lokasi', 'perlu_ditindak', 'status', 'status_sejak', 'tahun_pasang']);

  const isp = await run({ register: 'isp', hanya_perlu_ditindak: true });
  assert.equal(isp.daftar[0].penyedia, 'ISP Uji');
  assert.equal(isp.daftar[0].hari_sampai_kontrak_berakhir, 25);
  assert.equal(isp.daftar[0].perlu_ditindak, true);
  assert.equal(isp.rute, '/it/infrastructure?tab=isp');

  const backup = await run({ register: 'backup' });
  assert.equal(backup.daftar[0].terlambat_diperiksa, true);
  assert.equal(backup.daftar[0].hasil_terakhir, 'Gagal');
  assert.equal(backup.jumlah_perlu_ditindak, 1);

  const gws = await run({ register: 'google_workspace' });
  assert.equal(gws.review_terakhir.terlambat, true);
  assert.ok(gws.review_terakhir.jumlah_temuan >= 4);

  const phone = await run({ register: 'nomor_perusahaan' });
  assert.equal(phone.daftar[0].pemegang_sudah_resign, true);

  const elsewhere = await run({ register: 'cctv', lokasi: 'tidak ada' });
  assert.equal(elsewhere.total_cocok, 0);

  for (const out of [summary, network, isp, backup, gws, phone]) {
    const json = JSON.stringify(out);
    assert.doesNotMatch(json, BAIT);
    assert.doesNotMatch(json, /MikroTik|rsync|10\.99|CUST-|CAM-/);
    assert.ok(!json.includes(String(MONEY)));
  }
  for (const c of calls) assert.equal(c.args[0], 7, `bound to the user's company: ${c.sql.slice(0, 60)}`);
});

test('lists stay small: at most 50 rows per list by default input, whatever the tables hold', async (t) => {
  mockDb(t, { rows: 300 });
  for (const name of NAMES) {
    for (const input of INPUTS[name].filter((i) => !i.id_tiket && !i.id_perangkat && !i.id_langganan && !i.pemegang)) {
      const out = await tool(name).run(admin, { ...input, ...('jumlah' in tool(name).inputSchema.properties ? { jumlah: 999 } : {}) });
      const walk = (node, at) => {
        if (Array.isArray(node)) {
          assert.ok(node.length <= contract.MAX_LIST_ITEMS, `${name} ${at}: ${node.length}`);
          node.forEach((child) => walk(child, at));
        } else if (node && typeof node === 'object' && !(node instanceof Date)) {
          for (const [key, child] of Object.entries(node)) walk(child, `${at}.${key}`);
        }
      };
      walk(out, '$');
      for (const key of ['tiket', 'perangkat', 'langganan', 'daftar', 'lewat_tanggal_kembali']) {
        if (Array.isArray(out[key])) assert.ok(out[key].length <= 50, `${name}.${key}: ${out[key].length}`);
      }
    }
  }
});
