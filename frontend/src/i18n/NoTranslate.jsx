import { Fragment, createElement } from 'react';

// Record data and user-typed content are NEVER translated (customer, item and
// salesperson names, document numbers, notes, warehouse names, units, task
// titles, comments …). Wrap such a value, or spread `noTranslate` on the
// element that holds it:
//   <NoTranslate>{row.customerName}</NoTranslate>
//   <h1 {...noTranslate}>{project.name}</h1>
// Inside a no-translate zone, <Translate> (or `{...doTranslate}`) switches
// translation back on for an interface label:
//   <NoTranslate>{row.itemName} <Translate>(nonaktif)</Translate></NoTranslate>
// The nearest marker wins (i18n/domCore.js). Both render a plain <span>
// unless `as` names another tag.
// A word that means something else here than in the rest of the app takes a
// context: <Translate context="direction">Masuk</Translate> is "In", not
// "Sign in" (i18n/en/contexts.js lists them; a DataGrid column or a KeyValue
// item says `translateContext: 'direction'`).
export const noTranslate = { 'data-no-translate': '' };
export const doTranslate = { 'data-translate': '' };
// Only the element's own attributes are record data (an aria-label or a
// tooltip that is a record's title); its content follows the zone around it.
export const dataAttributes = { 'data-no-translate': 'attr' };

export function NoTranslate({ as = 'span', children, ...props }) {
  return createElement(as, { ...props, ...noTranslate }, children);
}

// `strict` marks a sentence zone: text the backend composes around record
// data (a notification body, an escalation's context line), or a field that
// holds either such a sentence or what a user typed. Only a whole sentence of
// the app is translated there; a word or two a user could have typed stays.
export const strictTranslate = { 'data-translate': 'strict' };

export function Translate({ as = 'span', context, strict = false, children, ...props }) {
  return createElement(as, { ...props, 'data-translate': strict ? 'strict' : '', 'data-i18n-context': context || undefined }, children);
}

// Names the meaning of the ambiguous labels inside (i18n/en/contexts.js)
// without adding a box to the layout — for a shared field whose label cannot
// carry the attribute itself:
//   <Context name="period"><DateInput label="Selesai" … /></Context>
export function Context({ name, children }) {
  return createElement('span', { style: { display: 'contents' }, 'data-i18n-context': name }, children);
}

// A line assembled from interface labels and record data, e.g. a meta line
// "Label tim · 4 Nov 2024 · Laptop booth pameran":
//   <Mixed parts={[HOLDER_KIND_LABELS[a.holderKind], formatDate(a.assignedAt), data(a.purpose)]} />
// A plain string (or `{ text }`) is interface text; `data(value)` marks a
// record's own text, which is never translated; `{ text, strict: true }` is a
// sentence zone (text the backend composes, or that may be typed by a user).
// Empty parts are dropped.
export const data = (text) => (text === null || text === undefined || text === '' ? null : { text, data: true });

export function Mixed({ parts, separator = ' · ' }) {
  const shown = (parts || []).filter((part) => part !== null && part !== undefined && part !== false && part !== '' && (typeof part !== 'object' || (part.text !== null && part.text !== undefined && part.text !== '')));
  return shown.map((part, index) => {
    const item = typeof part === 'object' ? part : { text: part };
    return createElement(
      Fragment,
      // eslint-disable-next-line react/no-array-index-key
      { key: index },
      index > 0 ? separator : null,
      createElement('span', item.data ? noTranslate : item.strict ? strictTranslate : doTranslate, item.text),
    );
  });
}

export default NoTranslate;
