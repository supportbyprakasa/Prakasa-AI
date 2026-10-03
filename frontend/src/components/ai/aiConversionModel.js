// Prakasa AI Wave 1 "dokumen dan file" (docs/prakasa-ai-rencana.md §10.1):
// what an answer can be turned into, and what a document of the conversation
// can be converted to. The server decides the conversions a document allows
// (artifact metadata `conversions`, by the same rule it converts with); this
// file only names and orders them for the chips and the menu.

export const FORMAT_LABELS = Object.freeze({
  pdf: 'PDF',
  docx: 'DOCX',
  xlsx: 'XLSX',
  pptx: 'PPTX',
  txt: 'TXT',
  md: 'Markdown',
  csv: 'CSV',
  gdoc: 'Google Doc',
  gsheet: 'Google Sheet',
  gslides: 'Google Slides',
});

export const FORMAT_DESCRIPTIONS = Object.freeze({
  pdf: 'File PDF, terunduh',
  docx: 'Word, terunduh',
  xlsx: 'Excel, terunduh',
  pptx: 'PowerPoint, terunduh',
  txt: 'Teks polos, terunduh',
  md: 'Teks Markdown, terunduh',
  csv: 'CSV, terunduh',
  gdoc: 'Dibuka dan diedit di Google Docs',
  gsheet: 'Dibuka dan diedit di Google Sheets',
  gslides: 'Dibuka dan diedit di Google Slides',
});

// A Google-native result lives in Drive and opens in its editor: nothing to download.
export const NATIVE_FORMATS = Object.freeze(['gdoc', 'gsheet', 'gslides']);
export const isNativeFormat = (format) => NATIVE_FORMATS.includes(String(format || '').toLowerCase());

// Under an answer: the file chips, then one "Google" menu for the native twins.
export const EXPORT_FILE_FORMATS = Object.freeze(['pdf', 'docx', 'xlsx', 'pptx']);
export const EXPORT_GOOGLE_FORMATS = Object.freeze(NATIVE_FORMATS);

const ORDER = Object.keys(FORMAT_LABELS);

/** Menu items for "Konversi ke…" from the formats the server allows, in a fixed order. */
export function conversionMenuItems(conversions) {
  const allowed = new Set((conversions || []).map((format) => String(format || '').toLowerCase()).filter((format) => FORMAT_LABELS[format]));
  return ORDER.filter((format) => allowed.has(format)).map((format) => ({
    value: format,
    label: FORMAT_LABELS[format],
    description: FORMAT_DESCRIPTIONS[format],
  }));
}

/** Menu items for the "Google" export chip under an answer. */
export const googleExportItems = () => EXPORT_GOOGLE_FORMATS.map((format) => ({ value: format, label: FORMAT_LABELS[format], description: FORMAT_DESCRIPTIONS[format] }));

/** What to tell the user once an artifact exists. */
export function artifactMessage(format, { converted = false } = {}) {
  const label = FORMAT_LABELS[format] || String(format || '').toUpperCase();
  const verb = converted ? 'Salinan' : label;
  if (isNativeFormat(format)) {
    return converted
      ? `Salinan ${label} dibuat di Shared Drive; buka lewat "Buka di Google Workspace".`
      : `${label} dibuat di Shared Drive; buka lewat panel dokumen atau "Buka di Google Workspace".`;
  }
  return converted
    ? `${verb} ${label} dibuat, disimpan di Shared Drive, dan diunduh`
    : `${label} dibuat, disimpan di Shared Drive, dan diunduh`;
}
