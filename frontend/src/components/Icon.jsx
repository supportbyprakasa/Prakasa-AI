import './icon.css';

// Material Symbols Outlined (docs/ui-guideline.md §1.11): the public
// equivalent of the admin console's icons. `name` is the symbol's ligature
// (e.g. "add", "more_vert"). Decorative by default; pass `label` when the
// icon alone carries meaning. Sizes: sm 18 (inside a labelled button), md 20
// (navigation), lg 24 (icon buttons, top bar, chips), xl 48 (empty states).
const SIZES = { sm: 'pw-icon--sm', md: 'pw-icon--md', lg: '', xl: 'pw-icon--xl' };

export default function Icon({ name, size = 'lg', filled = false, spin = false, label, className = '' }) {
  const classes = ['pw-icon', SIZES[size] ?? '', filled ? 'pw-icon--filled' : '', spin ? 'pw-icon--spin' : '', className]
    .filter(Boolean).join(' ');
  // The ligature is a symbol name, not text: the language switch must never
  // translate it ("text" = skip the content, the aria-label still translates).
  return label
    ? <span className={classes} role="img" aria-label={label} data-no-translate="text">{name}</span>
    : <span className={classes} aria-hidden="true" data-no-translate="text">{name}</span>;
}
