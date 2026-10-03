import Icon from '../../components/Icon';

const SYMBOLS = { document: 'description', spreadsheet: 'table_chart', presentation: 'slideshow' };

// Kind glyph in the Google app colour (blue Docs, green Sheets, yellow Slides),
// filled like the Google file icons. size: sm 18 | md 20 | lg 24 | xl 48.
export default function GoogleKindIcon({ kind, size = 'sm', className = '' }) {
  const known = Object.prototype.hasOwnProperty.call(SYMBOLS, kind) ? kind : 'document';
  return (
    <Icon
      name={SYMBOLS[known]}
      size={size}
      filled
      className={['gdocs-kind-icon', `gdocs-kind-icon--${known}`, className].filter(Boolean).join(' ')}
    />
  );
}
