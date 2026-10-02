import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import aiFormRegistry from './aiFormRegistry';
import { unsavedForms } from './aiFormModel';

// Opens a dialog from the URL — a link, or Prakasa AI's buka_halaman
// (docs/prakasa-ai-rencana.md §9.9): /ga?baru=atk, /sales/customers?baru=1,
// /tasks?board=3&ubah=41. The parameter is removed once the dialog is asked to
// open, so closing it (or reloading) does not open it again.
//
//   useOpenFromUrl('baru', () => setCreating(true));
//   useOpenFromUrl('baru', (kind) => setCreate({ kind }));            // ?baru=<jenis>
//   useOpenFromUrl('ubah', (id) => openEditor(Number(id)), { enabled: !loading });
//
// Parameter names the AI waits on: baru (create), ubah (edit, value = id),
// form (a named dialog), buat (a form made from a record, value = its id),
// aksi (an action dialog) — aiClientTools.js OPEN_PARAMS. `enabled: false` keeps
// the parameter until the page is ready (data the dialog needs has loaded).
// `open` only opens: it never saves.
//
// `keepUnsaved` — for a page where this opener REPLACES the dialog that is
// already open (one dialog state for several forms, as in Layanan GA or
// Infrastruktur IT) or would put a second dialog over it: while a registered
// form on the page holds unsaved input, the parameter is dropped and nothing is
// opened, so a link or Prakasa AI never discards what the user (or the AI)
// entered. Opening a form on the same page asks no "Pindah halaman?"
// (aiClientTools.js openRoute); this is what keeps that safe, and buka_halaman
// then names the unsaved form (`belum_disimpan`).
//   keepUnsaved: true            any registered form (every form of the page is a dialog)
//   keepUnsaved: ['id', 'id2']   only these forms (the page also has a form in
//                                the page itself, e.g. a comment box, which a dialog does not replace)
// `hasUnsavedForm(keep)` is the same check for a page that reads its own URL parameter.
export const hasUnsavedForm = (keep = true) => unsavedForms(aiFormRegistry.list(), keep).length > 0;

export default function useOpenFromUrl(param, open, { enabled = true, keepUnsaved = false } = {}) {
  const [params, setParams] = useSearchParams();
  const value = params.get(param);
  const latest = useRef(open);
  latest.current = open;
  const keep = useRef(keepUnsaved);
  keep.current = keepUnsaved;
  useEffect(() => {
    if (!value || !enabled) return;
    if (!hasUnsavedForm(keep.current)) latest.current(value);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(param);
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, param]);
}
