import { useTweenedNumber } from './motion';
import { formatMetric } from './chartModel';

// A figure that counts up to its value. Screen readers get the final value
// as text (a span's aria-label is not read by every screen reader).
export default function AnimatedNumber({ value, unit, compact = false, className = '' }) {
  const shown = useTweenedNumber(value);
  const final = formatMetric(value, unit, { compact });
  const rounded = unit === '%' || unit === 'hari' ? shown : Math.round(Number(shown));
  return (
    <span className={className}>
      <span className="pw-visually-hidden">{value === null || value === undefined ? 'Belum ada data' : final}</span>
      <span aria-hidden="true">{value === null || value === undefined ? '—' : formatMetric(rounded, unit, { compact })}</span>
    </span>
  );
}
