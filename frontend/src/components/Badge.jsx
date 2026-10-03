import './badge.css';

const TONE_NAMES = new Set(['default', 'success', 'warning', 'error', 'info']);

// Small label in a tone colour (docs/ui-guideline.md §4.12): coloured text,
// Roboto 12/18, no pill — like "Active" in the admin console. It never wraps
// mid-word. Statuses and priorities go through StatusBadge / PriorityBadge so
// the tone always comes from statusTone.js; Badge stays for other short
// labels (tone "default" is a neutral --pw-text-muted label).
// `translate` marks the text as an interface label for the language switch
// (translated even inside a record-data zone such as a grid cell).
export default function Badge({ children, tone = 'default', className = '', translate = false }) {
  const toneClass = TONE_NAMES.has(tone) ? tone : 'default';
  return <span className={['pw-badge', `pw-badge--${toneClass}`, className].filter(Boolean).join(' ')} data-translate={translate ? '' : undefined}>{children}</span>;
}
