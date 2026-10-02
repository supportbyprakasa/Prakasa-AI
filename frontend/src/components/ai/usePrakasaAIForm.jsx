import { useCallback, useEffect, useRef, useState } from 'react';
import Banner from '../Banner';
import Button from '../Button';
import IconButton from '../IconButton';
import aiFormRegistry from './aiFormRegistry';
import { bindAIForm } from './aiFormFields';
import { clearFilled, dismissNotice, filledCount, isRowFilled, syncForm, undoFill } from './aiFormModel';

// Lets Prakasa AI read and fill a form — the user still saves it (Wave C,
// docs/prakasa-ai-rencana.md §9.8; the rules are in aiFormModel.js).
//
//   const ai = usePrakasaAIForm({
//     id: 'it-ticket',                 // unique on the page; listed in the server's formCatalog when it opens by route
//     title: 'Tiket IT',               // shown in the AI's steps
//     permission: 'it_ticket.create',  // the form's own permission (re-checked on the server)
//     submitLabel: 'Ajukan tiket',     // the form's own save button, named in the notice
//     enabled: open,                   // a dialog registers only while it is open
//     initialValues: EMPTY_FORM,       // what counts as "not typed by the user"
//     fields: [{ name, label, type: 'text'|'textarea'|'number'|'date'|'time'|'select'|'checkbox'|'radio',
//                options?, required?, maxLength?, hint?, aiFillable? /* default true */ }],
//     getValues: () => form,
//     setValues: (patch) => setForm((f) => ({ ...f, ...patch })),   // the form's OWN setter
//     validate: (values) => ({ fieldName: 'pesan' }),               // optional: the form's own rules
//   });
//   …
//   {ai.notice}                                       // "Prakasa AI mengisi N kolom — periksa lalu tekan Simpan."
//   <Input label="Judul" {...ai.field('title')} … />  // highlight + "diisi AI"
//   ai.saved()                                        // after a successful save, when the form stays on screen
//
// The registry is told about the form only while `enabled`; when the form
// unmounts or closes, its marks go with it. Nothing here can press a button.
//
// Wave C2a (§9.9): the short form — a definition (aiFormFields.js) plus the
// component's own state:
//   const DEF = defineAIForm({ id, title, permission, submitLabel, fields: [f.text('title', 'Judul', { required: true }), …] });
//   const ai = usePrakasaAIForm(DEF, { enabled: open, values, setValues, setErrors, initialValues: EMPTY });
// Rows: <div className={ai.rowClass('items', index)}> … <Input {...ai.row('items', index)} /> per cell.
// An edit form: defineAIForm({ mode: 'edit', … }) and { record: { type: 'task', id }, initialValues: loaded }.
// One whole sentence per case (docs/bahasa.md: a text is translated as a whole).
function noticeText({ fields, rows }, submitLabel) {
  if (fields && rows) return `Prakasa AI mengisi ${fields} kolom dan ${rows} baris — periksa lalu tekan ${submitLabel}.`;
  if (rows) return `Prakasa AI mengisi ${rows} baris — periksa lalu tekan ${submitLabel}.`;
  return `Prakasa AI mengisi ${fields} kolom — periksa lalu tekan ${submitLabel}.`;
}

export default function usePrakasaAIForm(definition, bindings) {
  const { id, enabled = true, submitLabel = 'Simpan', ...config } = bindings ? bindAIForm(definition, bindings) : definition;
  const latest = useRef(config);
  latest.current = config;
  const entryRef = useRef(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !id) return undefined;
    const unregister = aiFormRegistry.register(id, () => latest.current);
    entryRef.current = aiFormRegistry.get(id);
    const unsubscribe = aiFormRegistry.subscribe(() => setTick((tick) => tick + 1));
    setTick((tick) => tick + 1);
    return () => {
      unsubscribe();
      unregister();
      entryRef.current = null;
    };
  }, [id, enabled]);

  // After every render: a field the user edited loses its mark.
  useEffect(() => {
    if (entryRef.current) syncForm(entryRef.current, aiFormRegistry);
  });

  const entry = enabled ? entryRef.current : null;
  const filled = entry ? filledCount(entry) : { fields: 0, rows: 0 };
  const count = entry ? entry.filled.size : 0;
  const undo = useCallback(() => { if (entryRef.current) undoFill(entryRef.current, aiFormRegistry); }, []);
  const saved = useCallback(() => { if (entryRef.current) clearFilled(entryRef.current, aiFormRegistry); }, []);
  const dismiss = useCallback(() => { if (entryRef.current) dismissNotice(entryRef.current, aiFormRegistry); }, []);
  const isFilled = (name) => Boolean(entry && entry.filled.has(name));
  const isRowFilled_ = (name, index) => Boolean(entry && entry.filled.has(name) && isRowFilled(entry, name, index));

  const notice = count > 0 && !entry.noticeDismissed ? (
    <div className="pw-ai-notice">
      <Banner
        tone="info"
        icon="auto_awesome"
        action={(
          <>
            <Button variant="text" type="button" icon="undo" onClick={undo}>Urungkan isian AI</Button>
            <IconButton size="sm" icon="close" label="Tutup pemberitahuan" onClick={dismiss} />
          </>
        )}
      >
        {noticeText(filled, submitLabel)}
      </Banner>
    </div>
  ) : null;

  return {
    // Spread on the control: <Input {...ai.field('title')} />.
    field: (name) => ({ aiFilled: isFilled(name) }),
    isFilled,
    // A row of a rows field the AI added: spread on each control of that row,
    // <Input {...ai.row('items', index)} />, and/or put rowClass on its wrapper.
    row: (name, index) => ({ aiFilled: isRowFilled_(name, index) }),
    rowClass: (name, index, className = '') => (isRowFilled_(name, index) ? `${className} is-ai-row`.trim() : className),
    isRowFilled: (name, index) => isRowFilled_(name, index),
    count,
    notice,
    undo,
    saved,
  };
}
