import Button from '../Button';

// Phone and tablet (< 1024 px): Prakasa AI filled a form and its panel stepped
// aside so the form can be checked. This chip floats over the form, says how
// much was filled, and brings the conversation back. It only shows and hides
// the panel: the form is saved with its own button, by the user.
function chipText({ fields, rows }) {
  if (fields && rows) return `Terisi ${fields} kolom dan ${rows} baris — periksa lalu simpan`;
  if (rows) return `Terisi ${rows} baris — periksa lalu simpan`;
  if (fields) return `Terisi ${fields} kolom — periksa lalu simpan`;
  return 'Kembali ke percakapan';
}

export default function AIFormChip({ filled, onOpen }) {
  return (
    <Button variant="primary" icon="auto_awesome" className="pw-ai-chip" onClick={onOpen} aria-label="Buka percakapan Prakasa AI">
      <span className="pw-ai-chip__body">
        <span className="pw-ai-chip__brand" data-no-translate="">Prakasa AI</span>
        <span className="pw-button__label">{chipText(filled)}</span>
      </span>
    </Button>
  );
}
