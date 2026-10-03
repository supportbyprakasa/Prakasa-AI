// The attribute a shared component puts on a title, a label or a value to
// say what the language switch may do with it (see NoTranslate.jsx):
//   true      record data (a name, a number, text a user typed) — never translated
//   'strict'  a sentence zone — text the backend composes around record data,
//             or a field that is either such a sentence or typed by a user:
//             only a whole sentence of the app is translated
//   falsy     interface text (nothing to add)
export function dataZone(data) {
  if (data === 'strict') return { 'data-translate': 'strict' };
  return data ? { 'data-no-translate': '' } : null;
}

// The same for a value that is record data unless it says otherwise (a grid
// cell, a KeyValue value): `translate` true = interface text, 'strict' = a
// sentence zone, falsy = record data.
export function valueZone(translate) {
  if (translate === 'strict') return { 'data-translate': 'strict' };
  return translate ? { 'data-translate': '' } : { 'data-no-translate': '' };
}
