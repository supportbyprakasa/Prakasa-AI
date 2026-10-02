import IconSlot from './IconSlot';
import './banner.css';

const ICONS = { info: 'info', success: 'check_circle', warning: 'warning', error: 'error', neutral: 'info' };
const KINDS = new Set(Object.keys(ICONS));

// Page or section notice (docs/ui-guideline.md §4.13), like the admin
// console's info banner: white, 1px border, 50px, a 24px icon in the tone
// colour, text in the body colour. tone: info | success | warning | error |
// neutral ("default" is read as neutral). `icon` overrides the tone's icon.
export default function Banner({ tone = 'info', title, children, action, icon }) {
  const kind = tone === 'default' ? 'neutral' : (KINDS.has(tone) ? tone : 'info');
  return (
    <div className={`pw-banner pw-banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <IconSlot icon={icon || ICONS[kind]} size="lg" className="pw-banner__icon" />
      <div className="pw-banner__body">
        {title ? <strong className="pw-banner__title">{title}</strong> : null}
        {children ? <span className="pw-banner__text">{children}</span> : null}
      </div>
      {action ? <div className="pw-banner__action">{action}</div> : null}
    </div>
  );
}
