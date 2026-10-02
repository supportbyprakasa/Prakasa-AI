// Pure data logic for DataGrid: validation, API payloads, import/export,
// alignment, paging and selection. Kept framework-free so it is unit-tested
// directly (test/gridModel.test.js, test/dataGrid.test.js).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Spreadsheet apps execute cells starting with these as formulas (CSV injection).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const isEditableColumn = (column) => column.editable !== false && !column.display;
const isEmpty = (value) => value == null || String(value).trim() === '';

function findOption(column, value) {
  return (column.options || []).find((option) => String(option.value) === String(value));
}

function findOptionByLabelOrValue(column, raw) {
  const needle = String(raw).trim().toLowerCase();
  return (column.options || []).find((option) => (
    String(option.label).trim().toLowerCase() === needle
    || String(option.value).trim().toLowerCase() === needle
  ));
}

export function validateValues(columns, values) {
  const errors = {};
  for (const column of columns) {
    if (!isEditableColumn(column)) continue;
    if (!(column.key in values) && !column.required) continue;
    const value = values[column.key];
    let message;

    if (isEmpty(value)) {
      if (column.required) message = `${column.header} wajib diisi`;
    } else if (column.type === 'email' && !EMAIL_PATTERN.test(String(value).trim())) {
      message = 'Format email tidak valid';
    } else if (column.type === 'number' && !Number.isFinite(Number(value))) {
      message = `${column.header} harus berupa angka`;
    } else if (column.type === 'select' && !findOption(column, value)) {
      message = `Pilihan ${column.header} tidak dikenal`;
    }

    if (!message && column.validate) message = column.validate(value, values) || undefined;
    if (message) errors[column.key] = message;
  }
  return errors;
}

function toApiValue(column, value) {
  if (column.toPayload) return column.toPayload(value);
  if (isEmpty(value)) return column.type === 'boolean' ? false : null;
  if (column.type === 'number') return Number(value);
  if (column.type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  if (column.type === 'select') {
    const option = findOption(column, value);
    return option ? option.value : value;
  }
  return typeof value === 'string' ? value.trim() : value;
}

export function payloadFromValues(columns, values) {
  const payload = {};
  for (const column of columns) {
    if (!isEditableColumn(column) || !(column.key in values)) continue;
    payload[column.payloadKey || column.key] = toApiValue(column, values[column.key]);
  }
  return payload;
}

export function displayValue(column, row) {
  if (column.exportValue) return column.exportValue(row);
  const value = row[column.key];
  if (column.type === 'select') return findOption(column, value)?.label ?? value ?? '';
  if (column.type === 'boolean') return value ? 'Ya' : 'Tidak';
  return value ?? '';
}

// Language switch (src/i18n): a cell VALUE is record data — names, numbers,
// notes from Accurate or typed by users — and is never translated. Only cells
// that show interface text are:
//   - `translate: true` on the column (a render that returns a label);
//   - a plain `select` / `boolean` column (option labels, "Ya" / "Tidak");
//   - inside any cell, the shared label components (StatusBadge,
//     PriorityBadge, Button, IconButton) and <Translate>, which opt back in.
// `translate: false` forces a select column's labels to stay as stored.
// Returns the attribute to put on the cell.
export function cellTranslation(column) {
  // 'strict': a sentence zone — a value the backend composes around record
  // data, or that a user may have typed (i18n/zones.js).
  // `translateContext` names the meaning of an ambiguous label (i18n/en/contexts.js):
  // it applies to the cell's labels and to the column header (the <th>, and the
  // header repeated in data-label on phones) — "Jumlah" = Quantity, not Amount.
  const context = column.translateContext ? { 'data-i18n-context': column.translateContext } : null;
  if (column.translate === 'strict') return { 'data-translate': 'strict', ...context };
  const translated = typeof column.translate === 'boolean'
    ? column.translate
    : !column.render && (column.type === 'select' || column.type === 'boolean');
  if (!translated) return { 'data-no-translate': '', ...context };
  return { 'data-translate': '', ...context };
}

const pad = (n) => String(n).padStart(2, '0');

function exportCell(column, row) {
  const value = displayValue(column, row);
  if (column.exportValue || (column.type !== 'date' && column.type !== 'datetime') || value === '') return value;
  // A plain calendar date must not shift a day through timezone conversion.
  if (column.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return column.type === 'date' ? day : `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function exportMatrix(columns, rows) {
  const exportable = columns.filter((column) => column.export !== false && !column.display);
  return [
    exportable.map((column) => column.header),
    ...rows.map((row) => exportable.map((column) => exportCell(column, row))),
  ];
}

function csvCell(value, delimiter) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  const needsQuotes = text.includes(delimiter) || /["\r\n]/.test(text);
  return needsQuotes ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(matrix, delimiter = ',') {
  // BOM so Excel opens UTF-8 (accents, "—") correctly.
  return `﻿${matrix.map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const [best, count] = [',', ';', '\t']
    .map((d) => [d, firstLine.split(d).length - 1])
    .toSorted((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

export function parseCsv(input) {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell); cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function importValue(column, raw) {
  if (raw == null) return '';
  if (column.importValue) return column.importValue(raw);
  if (column.type === 'select') {
    if (isEmpty(raw)) return '';
    return findOptionByLabelOrValue(column, raw)?.value ?? String(raw).trim();
  }
  if (column.type === 'number' && typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

export function rowsFromImportMatrix(columns, matrix) {
  const importable = columns.filter((column) => isEditableColumn(column) && column.import !== false);
  const [header = [], ...body] = matrix;
  const matched = header.map((cell) => {
    const needle = String(cell ?? '').trim().toLowerCase();
    return importable.find((column) => (
      column.header.toLowerCase() === needle || column.key.toLowerCase() === needle
    ));
  });

  const unknownHeaders = header
    .filter((cell, index) => !matched[index] && !isEmpty(cell))
    .map((cell) => String(cell).trim());
  const missingRequiredHeaders = importable
    .filter((column) => column.required && !matched.includes(column))
    .map((column) => column.header);

  const rows = [];
  body.forEach((cells, index) => {
    if (cells.every(isEmpty)) return;
    const values = {};
    matched.forEach((column, cellIndex) => {
      if (column) values[column.key] = importValue(column, cells[cellIndex]);
    });
    rows.push({ rowNumber: index + 2, values, errors: validateValues(importable, values) });
  });

  return { rows, unknownHeaders, missingRequiredHeaders };
}

// ---------------------------------------------------------------- layout
// Numbers and money sit right-aligned (docs/ui-guideline.md §4.9). A column's
// own `align` wins; "end" is the logical name for right in left-to-right text.
const NUMERIC_TYPES = new Set(['number', 'money']);
export function columnAlign(column) {
  if (column.align === 'end' || column.align === 'right') return 'right';
  if (column.align === 'center') return 'center';
  if (column.align) return undefined;
  return NUMERIC_TYPES.has(column.type) ? 'right' : undefined;
}

// Short values (dates, amounts, numbers, right/centre-aligned columns) never
// wrap, so a narrow column squeezes the free text beside it instead of
// breaking "30 Sep 2026" or "Rp 1.250.000" over two lines. `nowrap` on the
// column overrides.
const SHORT_TYPES = new Set(['number', 'money', 'date', 'datetime', 'boolean']);
export function columnNowrap(column) {
  if (typeof column.nowrap === 'boolean') return column.nowrap;
  return SHORT_TYPES.has(column.type) || columnAlign(column) !== undefined;
}

// Sort key: numeric strings from the API ("125000.00") sort as numbers in
// number/money columns; everything else keeps the display value.
export function sortKey(column, row) {
  if (column.sortValue) return column.sortValue(row);
  const value = displayValue(column, row);
  if (typeof value === 'number') return value;
  if (NUMERIC_TYPES.has(column.type) && value !== '' && value != null && Number.isFinite(Number(value))) return Number(value);
  return String(value ?? '');
}

// ---------------------------------------------------------------- paging
export const PAGE_SIZES = [10, 20, 50, 100];

export function pageCount(total, size) {
  const rows = Number(total) || 0;
  const perPage = Number(size) || 1;
  return Math.max(1, Math.ceil(rows / perPage));
}

// "a–b dari N" of the pager (Material data table): the rows shown on `page`.
// An empty list is 0–0 of 0.
export function pageRange(page, pageSize, total) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  if (!count) return { from: 0, to: 0, total: 0 };
  const size = Math.max(1, Number(pageSize) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount(count, size));
  return { from: (current - 1) * size + 1, to: Math.min(current * size, count), total: count };
}

// The page-size choices always include the size the page asked for.
export function pageSizeOptions(pageSize, base = PAGE_SIZES) {
  return [...new Set([...base, Number(pageSize)].filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- selection
export function toggleSelection(selected, id) {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

// Header checkbox: when every row of the page is selected it clears them,
// otherwise it adds the missing ones. Rows on other pages keep their state.
export function toggleAllSelection(selected, pageIds) {
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  if (allOn) return selected.filter((id) => !pageIds.includes(id));
  return [...selected, ...pageIds.filter((id) => !selected.includes(id))];
}

export function selectionState(selected, pageIds) {
  const count = pageIds.filter((id) => selected.includes(id)).length;
  if (!count) return 'none';
  return count === pageIds.length ? 'all' : 'some';
}

// ---------------------------------------------------------------- loading
// Skeleton bar widths: fixed per cell so the loading grid never jumps
// between renders (no Math.random).
const SKELETON_WIDTHS = [72, 48, 60, 36, 84, 54, 66, 42];
export function skeletonWidth(rowIndex, columnIndex) {
  return `${SKELETON_WIDTHS[(rowIndex * 3 + columnIndex) % SKELETON_WIDTHS.length]}%`;
}

export function fieldErrorsFromApi(error) {
  const fieldErrors = error?.response?.data?.error?.details?.fieldErrors || {};
  return Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([, messages]) => messages?.length)
      .map(([key, messages]) => [key, messages[0]]),
  );
}

export function apiErrorMessage(error, fallback) {
  return error?.response?.data?.error?.message || fallback;
}
