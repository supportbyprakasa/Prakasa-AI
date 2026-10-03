// Interface language: Indonesian ('id', the source language) or English ('en').
// The choice lives in localStorage and is fixed for the life of the page:
// setLanguage() reloads, so every text and format switches together.

export const LANGUAGES = ['id', 'en'];
export const LANGUAGE_KEY = 'pw.lang';

let current = null;

function read() {
  // Node (unit tests, the extractor) has no window: always Indonesian.
  if (typeof window === 'undefined') return 'id';
  try {
    const stored = window.localStorage?.getItem(LANGUAGE_KEY);
    return LANGUAGES.includes(stored) ? stored : 'id';
  } catch {
    return 'id';
  }
}

export function getLanguage() {
  if (current === null) current = read();
  return current;
}

export const isEnglish = () => getLanguage() === 'en';

// Sets <html lang> for the current language (called once at boot).
export function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = getLanguage();
}

export function setLanguage(lang) {
  const next = LANGUAGES.includes(lang) ? lang : 'id';
  if (next === getLanguage()) return;
  try {
    window.localStorage?.setItem(LANGUAGE_KEY, next);
  } catch {
    // Storage is blocked: the choice cannot be kept, so nothing changes.
    return;
  }
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (typeof window !== 'undefined') window.location.reload();
}

// The language to switch to after sign-in so the interface follows the
// account (users.language), or null when nothing changes: the account has no
// choice yet, or this browser already shows it. Once applied the two are equal,
// so the reload in setLanguage() can never repeat.
export function accountLanguageToApply(accountLanguage, currentLanguage = getLanguage()) {
  if (!LANGUAGES.includes(accountLanguage)) return null;
  return accountLanguage === currentLanguage ? null : accountLanguage;
}

// BCP 47 locale for Intl number/date formatters. Indonesian groups with dots
// ("1.234,5"), English with commas ("1,234.5"). The one place to change if
// numbers must stay Indonesian in the English interface.
// Decision (1 Oct 2026): numbers keep the Indonesian grouping in both
// languages ("Rp 1.234.567"), matching Accurate and the figures the server
// writes into messages; only dates and times follow the language.
export function numberLocale() {
  return 'id-ID';
}
export function dateLocale() {
  return getLanguage() === 'en' ? 'en-GB' : 'id-ID';
}

// Unit tests only: pin the language without storage or a reload.
export function setLanguageForTest(lang) {
  current = LANGUAGES.includes(lang) ? lang : 'id';
}
