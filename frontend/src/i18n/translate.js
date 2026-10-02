// Pure translation engine of the language switch (no DOM, no React).
//
// The source of the app stays Indonesian. English is a runtime layer: a text
// is looked up in an exact dictionary first, then in ordered patterns for
// interpolated strings. Unknown text is returned untouched.
//
// Pattern templates use $1, $2 … for the interpolated parts:
//   "$1 hari lalu"  →  "$1 days ago"
// In the English side a group is inserted VERBATIM with $1 (numbers, names,
// record data — never translated) and translated through the dictionary with
// $t1 (only for a part that is itself a UI label, e.g. a status label).

const HAS_LETTER = /\p{L}/u;
const HAS_LOWER = /\p{Ll}/u;
const WORD = /\p{L}{2,}/gu;
// How deep a pattern may translate its own pieces ("a · b" → "Label: x, y" → "3 baru").
const MAX_DEPTH = 6;
const CACHE_LIMIT = 20000;
const ANCHOR_BONUS = 6;

// Collapses whitespace runs to one space and trims: the dictionary key form.
export function normalizeText(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

export const hasLetters = (text) => HAS_LETTER.test(String(text ?? ''));

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "$1 dari $2 data" → "^([\s\S]*?) dari ([\s\S]*?) data$". Groups are in the
// order they appear in the template; the number after $ is the group's name.
export function templateToRegexSource(template) {
  const parts = normalizeText(template).split(/(\$\d+)/);
  return `^${parts.map((part) => (/^\$\d+$/.test(part) ? '([\\s\\S]*?)' : escapeRegex(part))).join('')}$`;
}

// Group numbers of a template in order of appearance: "$2 x $1" → [2, 1].
export function templateGroups(template) {
  return [...String(template).matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}

// The literal (non-placeholder) text of a template.
export function templateLiteral(template) {
  return normalizeText(String(template).replace(/\$\d+/g, ' '));
}

// Placeholders used by an English template: [{ n, translate }].
export function replacementGroups(to) {
  return [...String(to).matchAll(/\$(t?)(\d+)/g)].map((m) => ({ n: Number(m[2]), translate: m[1] === 't' }));
}

// A template is WEAK when its literal text is one word or less ("Ubah $1",
// "$1 dan $2", "$1 barang"): a record's own text can look like it. Two rules
// keep record data from being mistaken for interface text:
//  - a weak template with a free group at BOTH ends ("$1 dan $2",
//    "$1 barang$2") only matches when every group is a count, one token, a
//    known label, a date, or starts with a separator — never a phrase;
//  - a weak template declines when a group it would translate ($t) is not
//    interface text ("Tambah $t1" does not touch "Tambah lisensi Canva").
// One token that is the same in every language: an email address, a URL, a
// {{placeholder}} of a document template.
const NEUTRAL_TOKEN = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+|\{\{[\w.]+\}\})$/;
const SEPARATOR_START = /^\s*[·,;:(—–\-+/]/;
// A code, a number or a date: it has a digit, or no lowercase letter at all.
const CODE_LIKE = /\d|^[^\p{Ll}]+$/u;
// A count as the app writes it: "12", "± 3", "> 90", "62,5%".
const NUMBER_LIKE = /^[±><≥≤~]? ?\d[\d.,]*%?$/;
function compileTemplate(template, to) {
  const order = templateGroups(template);
  // position[n] = index of the regex group that holds template group $n.
  const position = new Map(order.map((n, index) => [n, index + 1]));
  const literal = templateLiteral(template);
  const text = normalizeText(template);
  const startsFree = /^\$\d+/.test(text);
  const endsFree = /\$\d+$/.test(text);
  const words = literal.match(WORD) || [];
  return {
    re: new RegExp(templateToRegexSource(template)),
    to,
    position,
    words,
    // The most specific template wins: the longest literal text, and a
    // literal start or end counts extra ("Ubah $1" before "$1 barang$2").
    weight: literal.length + (startsFree ? 0 : ANCHOR_BONUS) + (endsFree ? 0 : ANCHOR_BONUS),
    weak: words.length <= 1,
    open: startsFree && endsFree,
    // "Ubah $1", "Catat pemeriksaan $1": a label and then a record's title,
    // inserted as it is — whatever the title holds, " · " included.
    tail: !startsFree && order.length === 1 && endsFree && !/\$t\d/.test(to),
    translated: new Set(replacementGroups(to).filter((group) => group.translate).map((group) => group.n)),
    // " · " joins independent fragments ("Selesai · 3 hari lalu"): a template
    // that has no " · " of its own never matches across one — the fragments
    // are translated one by one instead (en/patterns.js).
    dots: literal.includes('·'),
  };
}

function compileManual(pattern) {
  const re = pattern.match instanceof RegExp ? pattern.match : new RegExp(pattern.match);
  return { re, to: pattern.to, position: null, words: pattern.word ? [pattern.word] : [], weight: Infinity, safe: Boolean(pattern.safe), strict: Boolean(pattern.safe || pattern.strict), split: Boolean(pattern.split), last: Boolean(pattern.fallback) };
}

// exact: { "<Indonesian>": "<English>" }
// patterns: ordered [{ match: RegExp | source string, to: string | (groups, t) => string, word? }]
//   (hand-written; `word` is an optional literal word every match contains,
//   used to skip the regex quickly; `fallback: true` = tried after the templates;
//   `safe: true` = a shape that is a formatted DATE, never a name or a note
//   ("Okt 2026", "Sen, 5 Okt"): it is also applied to a group a template
//   inserts verbatim with $n, because the backend bakes Indonesian month
//   names into the labels it sends)
// templates: { "<Indonesian with $n>": "<English with $n / $tn>" }
// same: strings that are identical in both languages (division names, brand
//   names …); only used by `t.known`, which a list pattern asks before it
//   translates "a, b dan c" piece by piece.
// finish: optional (english) => english applied to every pattern result (the
//   English singular: "1 days" → "1 day").
export function createTranslator({ exact = {}, patterns = [], templates = {}, same = [], finish = null } = {}) {
  const sameSet = new Set(same.map(normalizeText));
  // A template that reads the same in English ("Model $1", "Log #$1") is
  // listed as "same". It never translates anything; it only tells `covered`
  // that the text it builds is accounted for.
  const sameTemplates = same.filter((text) => /\$\d/.test(text) && /\p{L}{2,}/u.test(templateLiteral(text)))
    .map((text) => new RegExp(templateToRegexSource(text)));
  const dictionary = new Map();
  for (const [key, value] of Object.entries(exact)) {
    if (typeof value === 'string' && value !== '') dictionary.set(normalizeText(key), value);
  }

  // Hand-written patterns keep their order and come first; generated
  // templates follow, the most literal text first so the specific one wins.
  // A hand-written pattern marked `fallback: true` is tried last of all (a
  // generic shape such as "a · b" must not shadow a specific template).
  const compiled = [
    ...patterns.filter((pattern) => !pattern.fallback).map(compileManual),
    ...Object.entries(templates)
      .filter(([, to]) => typeof to === 'string' && to !== '')
      .map(([template, to]) => compileTemplate(template, to))
      // On a tie, the template that translates a group ($t) goes first: its
      // author knew the group holds text ("disetujui $t1" before "$1 hari lalu").
      .sort((a, b) => b.weight - a.weight || Number(b.to.includes('$t')) - Number(a.to.includes('$t'))),
    ...patterns.filter((pattern) => pattern.fallback).map(compileManual),
  ];
  // Index by the longest literal word, so a text only meets the few patterns
  // that can match it. Patterns without a literal word are always tried.
  const byWord = new Map();
  const always = [];
  compiled.forEach((pattern, index) => {
    const key = pattern.words.reduce((best, word) => (word.length > best.length ? word : best), '');
    if (!key) { always.push(index); return; }
    if (!byWord.has(key)) byWord.set(key, []);
    byWord.get(key).push(index);
  });

  const safePatterns = compiled.filter((pattern) => pattern.safe);
  const cache = new Map();

  function candidates(text) {
    const found = new Set(always);
    for (const word of new Set(text.match(WORD) || [])) {
      const list = byWord.get(word);
      if (list) for (const index of list) found.add(index);
    }
    return [...found].sort((a, b) => a - b);
  }

  // A verbatim group is record data and stays as it is — unless the whole
  // group is a formatted date (a `safe` pattern).
  function verbatim(value, depth) {
    if (!safePatterns.length || !HAS_LETTER.test(value)) return value;
    const key = normalizeText(value);
    for (const pattern of safePatterns) {
      const match = pattern.re.exec(key);
      if (!match) continue;
      const out = applyPattern(pattern, match, depth + 1);
      if (out !== null && out !== undefined) return out;
    }
    return value;
  }

  // The translate function a pattern gets for its own pieces.
  function makeT(pattern, depth) {
    // In a sentence zone (translate.strict) the pieces of "a · b" stay under
    // the strict rules; a piece a template names as a label ($t) is a label.
    const outer = strictMode;
    const t = (value) => {
      strictMode = outer && pattern.split;
      try { return translateCore(value, depth + 1); } finally { strictMode = outer; }
    };
    // Whether a piece is interface text: it translates, it is listed as
    // identical in English, or it has no letters at all. `t.exact` is the
    // strict form — the dictionary or the same list only, no pattern — for
    // a rule that must not mistake "Hanya Supervisor" (a template) for a label.
    t.known = (value) => {
      if (typeof value !== 'string' || !HAS_LETTER.test(value)) return true;
      if (sameSet.has(normalizeText(value))) return true;
      // A question, not a translation: it must not count as an uncovered piece.
      const before = uncovered;
      const known = translateCore(value, depth + 1) !== value;
      uncovered = before;
      return known;
    };
    // Whether the engine accounts for the whole piece (it translates, or a
    // pattern recognises it as it is: a date, money, a code). A rule that
    // would otherwise translate only half of a sentence asks this first.
    t.covers = (value) => {
      if (typeof value !== 'string' || !HAS_LETTER.test(value)) return true;
      const key = normalizeText(value);
      if (sameSet.has(key) || isNeutral(key)) return true;
      const state = [probing, uncovered, strictMode];
      probing = true; uncovered = false; strictMode = false;
      let ok = false;
      try { ok = resolve(key, depth + 1) !== null && !uncovered; } finally { [probing, uncovered, strictMode] = state; }
      return ok;
    };
    t.exact = (value) => {
      if (typeof value !== 'string' || !HAS_LETTER.test(value)) return true;
      const key = normalizeText(value);
      return sameSet.has(key) || dictionary.has(key) || sentenceCased(key) !== null || lowerCased(key) !== null;
    };
    return t;
  }

  function applyPattern(pattern, match, depth) {
    const groups = match.slice(1).map((group) => group ?? '');
    const outer = strictMode;
    const t = makeT(pattern, depth);
    if (typeof pattern.to === 'function') return pattern.to(groups, t);
    if (pattern.weak) {
      // See compileTemplate: record data must not pass for a weak template.
      const before = uncovered;
      const isLabel = (value) => !HAS_LETTER.test(value) || t.exact(value) || t.covers(value);
      const fits = [...pattern.position].every(([n, index]) => {
        const value = groups[index - 1].trim();
        // A sentence zone: every group must be a code, a number or a date
        // ("LPT-001 berakhir 2026-10-01"), never a word someone could type —
        // and never a phrase that merely holds a number ("6 barang habis …,
        // belum ada PO" is not the count of "$1 baru").
        if (outer) return value === '' || (CODE_LIKE.test(value) && (!/\s/.test(value) || NUMBER_LIKE.test(value) || safePatterns.some((safe) => safe.re.test(value))));
        if (pattern.translated.has(n)) return isLabel(value);
        if (!pattern.open) return true;
        // Free at both ends: a count, a code (one token with a digit, an "@"
        // or no lowercase letter), a known label, a date, or a fragment that
        // starts with a separator — never a plain word or a phrase.
        return value === '' || SEPARATOR_START.test(groups[index - 1]) || (!/\s/.test(value) && (CODE_LIKE.test(value) || value.includes('@'))) || NUMBER_LIKE.test(value) || isLabel(value);
      });
      uncovered = before;
      if (!fits) return null;
    }
    return pattern.to.replace(/\$(t?)(\d+)/g, (whole, flag, digits) => {
      const n = Number(digits);
      const index = pattern.position ? pattern.position.get(n) : n;
      if (!index || index > groups.length) return whole;
      const value = groups[index - 1];
      return flag === 't' ? t(value) : verbatim(value, depth);
    });
  }

  // A sentence-cased label ("Dilihat", from a map that holds "dilihat"): the
  // lowercase entry, capitalised again. null when there is none.
  function sentenceCased(key) {
    if (!/^\p{Lu}\p{Ll}/u.test(key)) return null;
    const lower = dictionary.get(key.charAt(0).toLowerCase() + key.slice(1));
    return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : null;
  }

  // Whether every group a template translates ($t) holds a known label.
  function labelled(pattern, match, depth) {
    const t = makeT(pattern, depth);
    const before = uncovered;
    const ok = [...pattern.translated].every((n) => {
      const value = (match[pattern.position.get(n)] ?? '').trim();
      // A label the dictionary holds as it is, or a date — not a phrase that
      // merely matches some other template.
      return value !== '' && HAS_LETTER.test(value) && (t.exact(value) || safePatterns.some((safe) => safe.re.test(value)));
    });
    uncovered = before;
    return ok;
  }

  // The reverse, for a piece inside a sentence: a label the app lower-cased
  // (`label.toLowerCase()`: "Cari pelanggan", "Peminjaman kendaraan") takes
  // the capitalised entry, lower-cased again.
  function lowerCased(key) {
    if (!/^\p{Ll}/u.test(key)) return null;
    const upper = dictionary.get(key.charAt(0).toUpperCase() + key.slice(1));
    if (!upper) return null;
    return /^\p{Lu}\p{Ll}/u.test(upper) ? upper.charAt(0).toLowerCase() + upper.slice(1) : upper;
  }

  // The English for a normalised key, or null when nothing matches (no
  // dictionary entry, no pattern, no sentence-cased entry).
  function resolve(key, depth) {
    // A sentence zone (translate.strict): text the backend composes around
    // record data, or a field that holds either a sentence of the app or what
    // a user typed. Only a whole sentence of the app is translated: a
    // dictionary entry of three words or more, a generated template, a date
    // or a count. One or two words ("Selesai", "Sudah dibayar") are what
    // people type themselves, and stay.
    const strict = strictMode;
    let result = dictionary.get(key) ?? null;
    if (strict && result !== null && key.split(' ').length < 3) result = null;
    if (result === null && depth < MAX_DEPTH) {
      // A hand-written `to` may decline (null): the next pattern is tried,
      // and what it looked at while deciding does not count.
      const attempt = (pattern, match) => {
        const before = uncovered;
        const out = applyPattern(pattern, match, depth);
        if (out === null || out === undefined) { uncovered = before; return null; }
        return finish ? finish(out) : out;
      };
      // Generated templates: one whose translated groups ($t) all hold known
      // labels explains the text best and wins ("$t1 baris $2" for
      // "Kode barang Accurate baris 1", not "Kode $1"). The others wait, in
      // their order of weight, until no such template is found.
      const waiting = [];
      const flush = () => {
        for (const [pattern, match] of waiting.splice(0)) {
          const out = attempt(pattern, match);
          if (out !== null) return out;
        }
        return null;
      };
      for (const index of candidates(key)) {
        const pattern = compiled[index];
        if (strict && !pattern.position && !pattern.strict && !pattern.split) continue;
        if (pattern.last && waiting.length) { result = flush(); if (result !== null) break; }
        const match = pattern.re.exec(key);
        if (!match) continue;
        if (pattern.position && !pattern.dots && match.some((group, i) => i > 0 && group && group.includes(' · '))) continue;
        if (pattern.position && !(pattern.translated.size && labelled(pattern, match, depth))) { waiting.push([pattern, match]); continue; }
        result = attempt(pattern, match);
        if (result !== null) break;
      }
      if (result === null && waiting.length) result = flush();
    }
    if (result === null && !strict) result = sentenceCased(key);
    if (result === null && !strict && depth > 0) result = lowerCased(key);
    return result;
  }

  // Set while `covered` runs: a piece a pattern asked to translate ($t, or
  // t() in a hand-written rule) that nothing covers.
  let probing = false;
  let uncovered = false;
  let strictMode = false;
  // Text that is the same in both languages by its shape: no lowercase
  // letter at all (a code or an abbreviation: "PO", "SKU-01", "RAM").
  const isNeutral = (key) => !HAS_LOWER.test(key) || NEUTRAL_TOKEN.test(key);

  function translateCore(text, depth) {
    if (typeof text !== 'string' || text === '' || !HAS_LETTER.test(text)) return text;
    const key = normalizeText(text);
    if (key === '') return text;
    let result = probing || strictMode ? undefined : cache.get(key);
    if (result === undefined) {
      result = resolve(key, depth);
      if (probing && result === null && depth > 0 && !sameSet.has(key) && !isNeutral(key)) uncovered = true;
      if (depth === 0 && !probing && !strictMode) {
        if (cache.size >= CACHE_LIMIT) cache.clear();
        cache.set(key, result);
      }
    }
    if (result === null || result === key) return text;
    // Keep the original's leading and trailing whitespace.
    const lead = text.match(/^\s*/)[0];
    const tail = text.slice(lead.length + text.trim().length);
    return `${lead}${result}${tail}`;
  }

  const translate = (text) => translateCore(text, 0);
  translate.has = (text) => typeof text === 'string' && translateCore(text, 0) !== text;
  // Translation for a sentence zone (data-translate="strict", see `resolve`).
  const strictCache = new Map();
  translate.strict = (text) => {
    if (typeof text !== 'string' || !HAS_LETTER.test(text)) return text;
    let result = strictCache.get(text);
    if (result === undefined) {
      strictMode = true;
      try { result = translateCore(text, 0); } finally { strictMode = false; }
      if (strictCache.size >= CACHE_LIMIT) strictCache.clear();
      strictCache.set(text, result);
    }
    return result;
  };
  // Whether the engine accounts for a text: it translates, it is listed as
  // identical in English, a pattern produces the same text ("Sep 2026",
  // "Rp 1.000"), or it has no lowercase letter (a code). A pattern that
  // translates its pieces one by one ("a · b") only counts when every piece
  // is covered. The dev crawl reports what is NOT covered (domTranslator.js).
  // `pieces: false` (an attribute: a tooltip or an aria-label joins a label
  // and a record's title in one string, which no zone can separate) accepts
  // any match, whatever its pieces.
  const coveredCache = new Map();
  translate.covered = (text, { pieces = true } = {}) => {
    if (typeof text !== 'string' || !HAS_LETTER.test(text)) return true;
    const key = normalizeText(text);
    if (sameSet.has(key) || isNeutral(key)) return true;
    let known = coveredCache.get(key);
    if (known === undefined) {
      probing = true;
      uncovered = false;
      let result = null;
      try { result = resolve(key, 0); } finally { probing = false; }
      known = result === null ? 0 : uncovered ? 1 : 2;
      if (known === 0 && sameTemplates.some((re) => re.test(key))) known = 2;
      // "Ubah Access point · Ubiquiti U6": translated piece by piece, with the
      // same result as the label template taking the whole title verbatim.
      if (known === 1 && key.includes(' · ') && compiled.some((pattern) => pattern.tail && pattern.re.test(key))) known = 2;
      if (coveredCache.size >= CACHE_LIMIT) coveredCache.clear();
      coveredCache.set(key, known);
    }
    return pieces ? known === 2 : known > 0;
  };
  translate.size = { exact: dictionary.size, patterns: compiled.length };
  return translate;
}
