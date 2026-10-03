// Translates the rendered page in place for the English interface.
//
// A MutationObserver on <html> translates text nodes (HTML and SVG) and a
// short list of attributes. It only ever sets nodeValue / attribute values —
// it never adds, removes, wraps or moves a node — so React's reconciliation
// is untouched. Per node/attribute it remembers the Indonesian original and
// what it wrote, which is how it tells its own writes from React updates.
//
// It is started only for English (main.jsx): in Indonesian nothing here runs.
//
// Record data and user content are never translated: any subtree marked
// data-no-translate is skipped (see NoTranslate.jsx); data-translate inside
// such a zone switches translation back on for interface labels.
import {
  ALWAYS_UI_ATTRIBUTES, NO_TRANSLATE_ATTR, STRICT, TRANSLATED_ATTRIBUTES, areAttributesTranslatable, contextTranslation, hasLabelValue, isHardSkipped, isTranslatable, nextState,
  ownZone, restoreValue,
} from './domCore.js';
import { hasLetters, normalizeText } from './translate.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

let observer = null;
let translate = null;
let sameSet = new Set();
// Words with a second meaning (en/contexts.js) and the set of those words, so
// only they pay for the ancestor walk.
let contexts = null;
let contextWords = new Set();
let collect = false;
let textRecords = new WeakMap();
let attrRecords = new WeakMap();

// Dev-only collectors for the browser crawl (text → a route where it was seen):
//   window.__pwI18nMisses  — interface text with no English translation
//   window.__pwI18nSkipped — text inside a no-translate zone that HAS a
//     translation (a label that needs data-translate / `translate: true`,
//     or record data that happens to equal an interface string)
function note(bucket, text) {
  if (!collect) return;
  const key = normalizeText(text);
  if (key.length < 2 || sameSet.has(key)) return;
  const map = window[bucket];
  if (map.size < 20000 && !map.has(key)) map.set(key, window.location.pathname);
}

// The translate function for a text inside `el`: the context's own
// translation when the word has one there, the dictionary otherwise.
function translatorFor(el, current, allowed) {
  if (allowed === STRICT) return translate.strict;
  if (!contextWords.size) return translate;
  const key = normalizeText(current);
  if (!contextWords.has(key)) return translate;
  const english = contextTranslation(contexts, el, key);
  return english === null ? translate : (text) => text.replace(key, english);
}

function apply(record, current, el, allowed, attribute = false) {
  const step = nextState(record, current, translatorFor(el, current, allowed));
  // A sentence zone holds record data too: what stays there is not a miss.
  if (collect && allowed !== STRICT && step.record !== record && hasLetters(current) && !translate.covered(current, { pieces: !attribute })) note('__pwI18nMisses', current);
  return step;
}

function translateText(node, allowed) {
  const current = node.nodeValue;
  if (!current) return;
  if (!allowed) {
    if (collect && hasLetters(current) && translate.has(current)) note('__pwI18nSkipped', current);
    return;
  }
  const record = textRecords.get(node);
  const step = apply(record, current, node.parentElement, allowed);
  if (step.record !== record) textRecords.set(node, step.record);
  if (step.write !== null) node.nodeValue = step.write;
}

function translateAttribute(el, name, zone) {
  if (!zone && !ALWAYS_UI_ATTRIBUTES.has(name)) return;
  // A column header (data-label) is plain interface text in every zone.
  const allowed = ALWAYS_UI_ATTRIBUTES.has(name) ? true : zone;
  const current = el.getAttribute(name);
  if (!current) return;
  let records = attrRecords.get(el);
  const record = records?.[name];
  const step = apply(record, current, el, allowed, true);
  if (step.record !== record) {
    if (!records) { records = {}; attrRecords.set(el, records); }
    records[name] = step.record;
  }
  if (step.write !== null) el.setAttribute(name, step.write);
}

function translateAttributes(el, allowed) {
  for (const name of TRANSLATED_ATTRIBUTES) if (el.hasAttribute(name)) translateAttribute(el, name, allowed);
  if (hasLabelValue(el) && el.hasAttribute('value')) translateAttribute(el, 'value', allowed);
}

// Depth-first over a subtree, carrying the zone down so no node needs an
// ancestor walk of its own.
function translateTree(root, allowed) {
  if (root.nodeType === TEXT_NODE) { translateText(root, allowed); return; }
  if (root.nodeType !== ELEMENT_NODE) return;
  const zone = ownZone(root);
  const inside = zone === null ? allowed : zone;
  // "text" skips the content only; the element's attributes follow its parent.
  const own = root.getAttribute(NO_TRANSLATE_ATTR);
  translateAttributes(root, own === 'attr' ? false : own === 'text' ? allowed : inside);
  if (isHardSkipped(root)) return;
  for (let child = root.firstChild; child; child = child.nextSibling) translateTree(child, inside);
}

function translateNode(node) {
  if (!node.isConnected) return;
  const parent = node.parentElement;
  translateTree(node, parent ? isTranslatable(parent) : true);
}

function onMutations(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) translateNode(node);
    } else if (mutation.type === 'characterData') {
      const node = mutation.target;
      if (node.nodeType === TEXT_NODE && node.isConnected && node.parentElement) translateText(node, isTranslatable(node.parentElement));
    } else if (mutation.type === 'attributes') {
      const el = mutation.target;
      const name = mutation.attributeName;
      if (!el.isConnected) continue;
      if (name === 'value' && !hasLabelValue(el)) continue;
      translateAttribute(el, name, areAttributesTranslatable(el));
    }
  }
}

// translateFn: from createTranslator(); same: strings identical in both
// languages (not reported as misses); dev: turn the collectors on.
export function startDomTranslator({ translate: translateFn, same = [], contexts: contextMap = null, dev = false }) {
  if (observer || typeof MutationObserver === 'undefined') return;
  translate = translateFn;
  contexts = contextMap;
  contextWords = new Set(Object.values(contextMap || {}).flatMap((words) => Object.keys(words)));
  sameSet = new Set(same.map(normalizeText));
  collect = Boolean(dev);
  if (collect) {
    window.__pwI18nMisses = new Map();
    window.__pwI18nSkipped = new Map();
    // { misses: [[text, route]…], skipped: [[text, route]…] } for a crawl.
    window.__pwI18nReport = () => ({ misses: [...window.__pwI18nMisses], skipped: [...window.__pwI18nSkipped] });
  }
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATED_ATTRIBUTES, 'value'],
  });
  // What is already on the page (index.html: the title, the root).
  translateTree(document.documentElement, true);
}

// Stops translating and puts the Indonesian originals back wherever the page
// still shows our text. (The switch itself reloads; this is for embedding
// and tests.)
export function stopDomTranslator() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === TEXT_NODE) {
      const original = restoreValue(textRecords.get(node), node.nodeValue);
      if (original !== null) node.nodeValue = original;
    } else {
      const records = attrRecords.get(node);
      if (records) {
        for (const [name, record] of Object.entries(records)) {
          const original = restoreValue(record, node.getAttribute(name));
          if (original !== null) node.setAttribute(name, original);
        }
      }
    }
  }
  textRecords = new WeakMap();
  attrRecords = new WeakMap();
  translate = null;
}
