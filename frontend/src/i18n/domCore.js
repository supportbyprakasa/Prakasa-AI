// Pure rules of the DOM translator (no browser needed; unit tested).

// Attributes whose value is interface text.
export const TRANSLATED_ATTRIBUTES = [
  'placeholder', 'aria-label', 'title', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext',
  // The shared tooltip (components/tooltip.js) and the phone layout's cell
  // labels (content: attr(data-label)).
  'data-pw-tooltip', 'data-label',
];
// Always interface text, even on an element that marks a record-data zone:
// data-label is the COLUMN HEADER of a grid cell, never the cell's value.
export const ALWAYS_UI_ATTRIBUTES = new Set(['data-label']);

export const NO_TRANSLATE_ATTR = 'data-no-translate';
export const TRANSLATE_ATTR = 'data-translate';
// Names the meaning of the labels inside ("direction": Masuk = In).
export const CONTEXT_ATTR = 'data-i18n-context';

// The translation of `text` in the context an element sits in, or null.
// contexts: { "<context>": { "<Indonesian>": "<English>" } }.
export function contextTranslation(contexts, el, text) {
  if (!contexts || !el) return null;
  for (let node = el; node; node = node.parentElement ?? node.parentNode) {
    const name = node.getAttribute?.(CONTEXT_ATTR);
    if (name) return contexts[name]?.[text] ?? null;
  }
  return null;
}

// Content that is never interface text.
const HARD_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);

const tagOf = (el) => String(el.tagName || el.nodeName || '').toUpperCase();

export const isHardSkipped = (el) => HARD_SKIP_TAGS.has(tagOf(el));

function isEditable(el) {
  const value = el.getAttribute?.('contenteditable');
  return value !== null && value !== undefined && value !== 'false';
}

// A sentence zone: data-translate="strict". Text the backend composes around
// record data (a notification body, an escalation's context line) — or a
// field that is either such a sentence or what a user typed. Only a whole
// sentence of the app is translated there (translate.strict).
export const STRICT = 'strict';

// What an element says about its own subtree: false = record data / user
// content (never translated), true = interface text (translated even inside a
// data zone), 'strict' = a sentence zone, null = nothing (inherits).
export function ownZone(el) {
  if (!el || typeof el.hasAttribute !== 'function') return null;
  // "attr": only the element's own attributes are record data (an aria-label
  // that is a record's title); its content follows the zone it sits in.
  if (el.hasAttribute(NO_TRANSLATE_ATTR) && el.getAttribute(NO_TRANSLATE_ATTR) !== 'attr') return false;
  if (isHardSkipped(el) || isEditable(el)) return false;
  if (el.hasAttribute(TRANSLATE_ATTR)) return el.getAttribute(TRANSLATE_ATTR) === STRICT ? STRICT : true;
  return null;
}

// Whether text directly inside `el` (and el's own attributes) is translated:
// the NEAREST marker on el or an ancestor decides; no marker = translated.
export function isTranslatable(el) {
  for (let node = el; node; node = node.parentElement ?? node.parentNode) {
    const zone = ownZone(node);
    if (zone !== null) return zone;
  }
  return true;
}

// Whether an element's OWN attributes (aria-label, title …) are translated.
// data-no-translate="text" skips only the element's content (an icon
// ligature): its attributes follow the zone it sits in.
export function areAttributesTranslatable(el) {
  if (el.getAttribute?.(NO_TRANSLATE_ATTR) === 'attr') return false;
  if (el.getAttribute?.(NO_TRANSLATE_ATTR) === 'text') {
    const parent = el.parentElement ?? el.parentNode;
    return parent ? isTranslatable(parent) : true;
  }
  return isTranslatable(el);
}

// The `value` of a button-like input is its label; any other value is typed
// by the user and is never touched.
export function hasLabelValue(el) {
  return tagOf(el) === 'INPUT' && BUTTON_INPUT_TYPES.has(String(el.getAttribute?.('type') || '').toLowerCase());
}

// One step of the "who wrote this?" rule for a text node or an attribute.
//   record  = { original, written } remembered for the node/attribute, or undefined
//   current = the value in the DOM now
// Returns { record, write }: `write` is the text to put in the DOM, or null.
// The DOM holding exactly what we last wrote is our own write (or nothing
// changed): no work. Anything else is a new original from React.
export function nextState(record, current, translate) {
  if (record && current === record.written) return { record, write: null };
  const translated = translate(current);
  return {
    record: { original: current, written: translated },
    write: translated === current ? null : translated,
  };
}

// Restoring Indonesian: only when the DOM still holds our own text.
export function restoreValue(record, current) {
  return record && current === record.written && record.original !== record.written ? record.original : null;
}
