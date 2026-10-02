// Language boot, called by main.jsx before React renders. Indonesian does
// nothing. English loads the dictionary (its own lazy chunk) and starts the
// DOM translator first, so the first paint is already English.
import { applyDocumentLanguage, getLanguage } from './language.js';
import { setTranslator } from './tr.js';

export async function bootLanguage() {
  applyDocumentLanguage();
  if (getLanguage() !== 'en') return;
  try {
    const [{ exact, templates, patterns, same, finish, contexts }, { createTranslator }, { startDomTranslator }] = await Promise.all([
      import('./en/index.js'),
      import('./translate.js'),
      import('./domTranslator.js'),
    ]);
    const translate = createTranslator({ exact, templates, patterns, same, finish });
    // Strings that never reach the DOM as text (document.title, option labels).
    setTranslator(translate, contexts);
    startDomTranslator({ translate, same, contexts, dev: import.meta.env.DEV });
  } catch (error) {
    // The dictionary failed to load: the app still works, in Indonesian.
    console.error('English dictionary failed to load', error);
  }
}
