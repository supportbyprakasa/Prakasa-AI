// A small synthetic "IT - Device Management Report" in the owner's layout:
// sheet "Device Inventory" (two title rows, the header row, device rows of
// several companies, the summary block) and the hidden "User List". Names and
// serials are invented; the column layout is the real report's.

const DEVICE_HEADER = ['No', 'Device Type', 'Brand / Model', 'Serial Number', 'Asset No.', 'Purchase Year', 'User Name', 'Location', 'Company', 'Status', 'Notes'];
const PEOPLE_HEADER = ['No', 'Employee Name', 'Position', 'Entity', 'Status', 'Email'];

function deviceSheet(rows, { extraColumns = [] } = {}) {
  const width = DEVICE_HEADER.length + extraColumns.length;
  const pad = (r) => [...r, ...Array(Math.max(0, width - r.length)).fill(null)];
  return [
    pad(['IT Device Inventory', 2026]),
    pad(['Entity from PMK · PFN · IGS']),
    [...DEVICE_HEADER, ...extraColumns.map((c) => c.header)],
    ...rows.map((r, i) => [i + 1, ...r, ...extraColumns.map((c) => c.value)]),
    pad([]),
    pad(['Active', null, null, null, null, null, null, null, null, 7]),
    pad(['Spare', null, null, null, null, null, null, null, null, 2]),
    pad(['Damaged', null, null, null, null, null, null, null, null, 1]),
    pad(['Not Active', null, null, null, null, null, null, null, null, 1]),
    pad(['TOTAL', null, null, null, null, null, null, null, null, 13]),
  ];
}

function peopleSheet(rows, { extraColumns = [] } = {}) {
  return [
    [...PEOPLE_HEADER, ...extraColumns.map((c) => c.header)],
    ...rows.map((r, i) => [i + 1, ...r, ...extraColumns.map((c) => c.value)]),
  ];
}

// Device rows: [type, brand/model, serial, asset no., year, user name, location, company, status, notes]
const DEVICES = [
  ['Laptop', 'Lenovo IdeaPad Slim 5', 'pf01sn001', 'LAP/PFN/2024/002', 2024, 'Ani Wijaya', 'PFN Office', 'PFN', 'Active', null],
  ['Laptop', 'Lenovo ThinkPad E14', 'PF01SN002', 'LAP/PFN/2024/002', 2024, 'Budi Santoso', 'PFN Office', 'PFN', 'Active', null],
  ['Mobile Phone', 'Iphone 14', 'PF01SN003', null, 2023, 'Citra Lestari', 'Alsut Office', 'PFN', 'Active', null],
  ['Monitor', 'LG 24MK600', 'PF01SN004', null, 2022, 'Ops Team', 'PFN Office', 'PFN', 'Active', null],
  ['Printer Label', 'Zebra ZD230', 'PF01SN005', null, null, 'Dewi Anggraini', 'PFN Office', 'PFN', 'Active', null],
  ['Combo Touch', 'Logi CANICES-3', 'PF01SN006', null, null, 'Ops Team', 'PFN Office', 'PFN', 'Spare', null],
  ['Monitor', 'Samsung S24', null, null, 2021, null, 'Alsut Office', 'PFN', 'Spare', null],
  ['Laptop', 'Asus Vivobook 14', 'PF01SN008', 'LAP/PFN/2023/008', 2023, 'Eko Prasetyo', 'Alsut Office', 'PFN', 'Damaged', 'Layar pecah'],
  ['Hoverboard', 'Xiaomi Mi', 'PF01SN009', null, 2020, 'Rahmat IGS', 'Alsut Office', 'PFN', 'Active', null],
  ['Telephone', 'Yealink T31P', 'PF01SN010', null, 2019, 'Fajar Nugroho', 'Gudang Cikarang', 'PFN', 'Not Active', null],
  ['Fingerprint', 'Deli', 'S/N64485346503', null, null, 'All User', 'PMK Office', 'PMK', 'Active', 'Attendance fingerprint'],
  ['Laptop', 'Dell Latitude 5420', 'IG01SN001', null, 2022, 'Rahmat IGS', 'IGS Office', 'IGS', 'Active', null],
  ['Laptop', 'HP 240 G8', 'D7SN001', null, 2022, 'Tono', 'Alsut Office', 'Djaya77', 'Active', null],
];

// People rows: [name, position, entity, status, email]
const PEOPLE = [
  ['Ani Wijaya', 'Admin Sales', 'PFN', 'Active', 'ani.wijaya@prakasafoods.com'],
  ['Budi Santoso', 'Staff Finance', 'PFN', 'Active', null],
  ['Citra Lestari', 'Sales Supervisor', 'PFN', 'Active', 'citra.pribadi@gmail.com'],
  ['Dewi Anggraini', 'Admin Gudang', 'PFN', 'Active', 'dewi@prakasafoods.com'],
  ['Eko Prasetyo', 'Driver', 'PFN', 'Resign', '-'],
  ['Rahmat IGS', 'Sales', 'IGS', 'Active', 'rahmat@indoseas.com'],
];

const buildReport = ({ devices = DEVICES, people = PEOPLE, deviceExtra, peopleExtra } = {}) => ({
  devices: deviceSheet(devices, { extraColumns: deviceExtra }),
  people: peopleSheet(people, { extraColumns: peopleExtra }),
});

module.exports = { DEVICE_HEADER, PEOPLE_HEADER, DEVICES, PEOPLE, deviceSheet, peopleSheet, buildReport };
