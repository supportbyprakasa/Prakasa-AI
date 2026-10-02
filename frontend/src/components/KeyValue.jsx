import { Mixed } from '../i18n/NoTranslate.jsx';
import { valueZone } from '../i18n/zones.js';
import './key-value.css';

// Label → value pairs for detail pages (docs/ui-guideline.md §3.2):
// labels Roboto 13 --pw-text-muted, values Roboto 14 --pw-text. items:
// [{ label, value }]; an empty value renders a muted em dash so rows never
// collapse. columns={2} puts the pairs in two columns (one on phones).
// Language switch: the label is interface text; the VALUE is record data and
// is never translated, unless the item says `translate: true` (a value that
// is a label, e.g. "Ya" / a type name). StatusBadge, PriorityBadge, Button and
// <Translate> inside a value are translated either way. `translateContext`
// names the meaning of an ambiguous word in the label or the value
// (i18n/en/contexts.js).
// `translate: 'strict'` = a sentence zone (i18n/zones.js).
export default function KeyValue({ items, columns = 1 }) {
  return (
    <dl className={`pw-kv${columns === 2 ? ' pw-kv--2' : ''}`}>
      {(items || []).filter(Boolean).map((item) => (
        <div className="pw-kv__row" key={item.key || item.label} data-i18n-context={item.translateContext}>
          <dt className="pw-kv__label">{item.label}</dt>
          {item.parts
            // `parts`: a value assembled from labels and record data — each part
            // carries its own zone (i18n/NoTranslate.jsx, <Mixed>).
            ? <dd className="pw-kv__value"><Mixed parts={item.parts} separator={item.separator ?? ' · '} /></dd>
            : <dd className="pw-kv__value" {...valueZone(item.translate)}>{item.value === null || item.value === undefined || item.value === '' ? <span className="pw-kv__empty">—</span> : item.value}</dd>}
        </div>
      ))}
    </dl>
  );
}
