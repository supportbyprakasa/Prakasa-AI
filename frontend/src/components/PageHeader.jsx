import { dataZone } from '../i18n/zones.js';
import { usePublishPrakasaAIPart } from '../context/PrakasaAIToolContext';
// The one page heading (docs/ui-guideline.md §2.3): title Google Sans 24/32,
// optional description, and an actions slot that wraps under the text on
// narrow screens. It carries no outer margin: <Page> owns the spacing.
// `dataTitle`: the title is a record's own name or number (a customer, an
// order), so the language switch never translates it; "strict" = a title the
// backend composes or a user types (i18n/zones.js).
// Prakasa AI: the heading is published as the page title (standard page
// context, components/ai/aiPageContext.js) — only when it is the app's own
// text; a record's name (dataTitle) is left to the page to publish on purpose.
export default function PageHeader({ title, description, actions, eyebrow, children, dataTitle = false }) {
  usePublishPrakasaAIPart('header', typeof title === 'string' && title && !dataTitle ? { title } : null);
  return (
    <header className="pw-page-header">
      <div className="pw-page-header__text">
        {eyebrow ? <span className="pw-page-header__eyebrow">{eyebrow}</span> : null}
        <h1 className="pw-page-header__title" {...dataZone(dataTitle)}>{title}</h1>
        {description ? <div className="pw-page-header__description">{description}</div> : null}
        {children}
      </div>
      {actions ? <div className="pw-page-header__actions">{actions}</div> : null}
    </header>
  );
}
