import { useRef } from 'react';
import { useSeen } from './motion';
import './bar-list.css';

const BAR_COLOURS = new Set(['default', 'info', 'warning', 'error', 'success']);

// A ranked list of horizontal bars (e.g. aging buckets): a label, a bar whose
// length is the item's share of the largest one, and the formatted value with
// an optional note. The bars grow from zero once the list comes into view
// (--pw-dur-chart / --pw-ease-chart); nothing moves with reduced motion.
// items: [{ key, label, value, display, note?, tone? }] — `display` is the
// value already formatted (formatMoney / compactMoney); tone colours the bar.
// An item with `translate: true` is an interface label among record names
// ("Tanpa channel", "Lainnya"): it stays translatable.
// `dataLabels`: the labels are record data (product, customer, channel or
// platform names), never translated by the language switch.
export default function BarList({ items = [], label, max, dataLabels = false }) {
  const box = useRef(null);
  const seen = useSeen(box);
  const top = Math.max(Number(max) || 0, ...items.map((i) => Number(i.value) || 0));
  return (
    <ul className={`pw-bar-list${seen ? ' is-seen' : ''}`} ref={box} aria-label={label}>
      {items.map((item) => {
        const share = top > 0 ? Math.max(0, Math.min(100, ((Number(item.value) || 0) / top) * 100)) : 0;
        const tone = BAR_COLOURS.has(item.tone) ? item.tone : 'default';
        return (
          <li key={item.key} className="pw-bar-list__row">
            <span className="pw-bar-list__label" data-no-translate={dataLabels && !item.translate ? '' : undefined}>{item.label}</span>
            <span className="pw-bar-list__track" aria-hidden="true">
              <span className={`pw-bar-list__fill is-${tone}`} style={{ '--pw-bar-share': `${share}%` }} />
            </span>
            <span className="pw-bar-list__value">
              <span className="pw-bar-list__amount">{item.display ?? item.value}</span>
              {item.note ? <span className="pw-bar-list__note">{item.note}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
