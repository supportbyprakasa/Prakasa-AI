import { parseCsv, toCsv } from './gridModel';
import { todayIso } from '../../pages/projects/trackerModel';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => todayIso();

// `sheet` names the Excel sheet (default "Data"), e.g. "Device Inventory" so
// an exported device list imports back as the owner's report.
export async function downloadMatrix(matrix, baseName, format, { sheet: sheetName = 'Data' } = {}) {
  const filename = `${baseName}-${stamp()}.${format}`;
  if (format === 'csv') {
    saveBlob(new Blob([toCsv(matrix)], { type: 'text/csv;charset=utf-8' }), filename);
    return;
  }
  // Loaded on demand so the Excel writer stays out of the main bundle.
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const [header, ...body] = matrix;
  const sheet = [
    header.map((value) => ({ value, fontWeight: 'bold' })),
    ...body.map((row) => row.map((value) => (value === '' ? null : value))),
  ];
  const blob = await writeExcelFile(sheet, {
    sheet: sheetName,
    stickyRowsCount: 1,
    columns: header.map((label) => ({ width: Math.min(Math.max(String(label).length + 6, 14), 48) })),
  }).toBlob();
  saveBlob(blob, filename);
}

export async function readMatrixFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text());
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/universal');
    return readSheet(file);
  }
  throw new Error('Format file tidak didukung. Gunakan .xlsx atau .csv.');
}

export function downloadTemplate(columns, baseName) {
  const header = columns.map((column) => column.header);
  return downloadMatrix([header], `${baseName}-template`, 'xlsx');
}

// Every sheet of an .xlsx (hidden ones included): [{ sheet: name, data: rows }].
export async function readSheetsFromFile(file) {
  if (!String(file?.name || '').toLowerCase().endsWith('.xlsx')) throw new Error('Format file tidak didukung. Gunakan file .xlsx.');
  const { default: readXlsxFile } = await import('read-excel-file/universal');
  return readXlsxFile(file);
}
