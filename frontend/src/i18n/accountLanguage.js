import api from '../api/client';
import { LANGUAGES, getLanguage, setLanguage } from './language.js';

// Long enough for a slow office line, short enough that the switch still
// feels immediate when the server cannot be reached.
const SAVE_TIMEOUT_MS = 4000;

const signedIn = () => {
  try {
    return Boolean(window.localStorage?.getItem('prakasa.token'));
  } catch {
    return false;
  }
};

// Saves the interface language on the signed-in account
// (PATCH /auth/me/preferences). Throws when the server refuses or is away.
export async function saveAccountLanguage(language) {
  await api.patch('/auth/me/preferences', { language }, { timeout: SAVE_TIMEOUT_MS });
}

// The top bar's switch: the choice is saved on the account when someone is
// signed in (best effort — the login page, an offline browser and a held
// session still switch), then the page reloads in the new language. The save
// is awaited first because the reload would cancel a request still in flight.
export async function chooseLanguage(language) {
  if (!LANGUAGES.includes(language) || language === getLanguage()) return;
  if (signedIn()) {
    try {
      await saveAccountLanguage(language);
    } catch {
      // Not saved on the account; this browser still switches.
    }
  }
  setLanguage(language);
}
