// Synchronous translation for text that never becomes a DOM text node or a
// translated attribute, so the DOM translator cannot reach it: document.title,
// the label of a <select> option that mixes a record name with an interface
// suffix ("Budi (nonaktif)"), canvas text, a native confirm().
//
//   tr('(nonaktif)')            → "(inactive)" in English, the same text in Indonesian
//   tr('Masuk', 'direction')    → "In" (a context of en/contexts.js)
//
// In Indonesian, and before the dictionary has loaded, it returns the text
// untouched. Never pass record data: only interface strings written in the
// source, so the extractor (scripts/i18n-extract.mjs) can catalogue them.
let translate = null;
let contexts = null;

// Called by boot.js once the English dictionary is ready.
export function setTranslator(translateFn, contextMap = null) {
  translate = translateFn;
  contexts = contextMap;
}

export function tr(text, context) {
  if (!translate || typeof text !== 'string') return text;
  if (context) {
    const english = contexts?.[context]?.[text.trim()];
    if (english) return text.replace(text.trim(), english);
  }
  return translate(text);
}

// A record name with an interface suffix, for a string-only place:
// withSuffix('Budi', '(nonaktif)') → "Budi (inactive)". The name is never
// translated.
export function withSuffix(name, suffix) {
  return suffix ? `${name} ${tr(suffix)}` : String(name ?? '');
}
