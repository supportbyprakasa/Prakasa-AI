import { getLanguage } from '../i18n/language.js';
import { chooseLanguage } from '../i18n/accountLanguage.js';
import './language-switch.css';

const OPTIONS = [
  { value: 'id', code: 'ID', name: 'Bahasa Indonesia' },
  { value: 'en', code: 'EN', name: 'English' },
];

// Interface language switch: a compact two-option segmented control "ID | EN"
// (top bar next to the notification bell; top-right corner of the login
// screens). Choosing a language saves it on the signed-in account (best
// effort, i18n/accountLanguage.js) and reloads the page (i18n/language.js). On
// phones (≤600px) it folds into one button showing the active code, which
// switches to the other language. Its own text is never translated.
export default function LanguageSwitch({ className = '' }) {
  const language = getLanguage();
  const other = OPTIONS.find((option) => option.value !== language);
  const active = OPTIONS.find((option) => option.value === language);
  return (
    <div className={['pw-lang', className].filter(Boolean).join(' ')} role="group" aria-label="Bahasa / Language" data-no-translate="">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          className={`pw-lang__option pw-state-layer${option.value === language ? ' is-selected' : ''}`}
          aria-pressed={option.value === language}
          aria-label={option.name}
          onClick={() => chooseLanguage(option.value)}
        >
          {option.code}
        </button>
      ))}
      <button data-no-translate=""
        type="button"
        className="pw-lang__toggle pw-state-layer"
        aria-label={`${active.name} → ${other.name}`}
        onClick={() => chooseLanguage(other.value)}
      >
        {active.code}
      </button>
    </div>
  );
}
