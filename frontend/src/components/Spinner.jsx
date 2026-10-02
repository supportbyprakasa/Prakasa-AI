import './spinner.css';

const SIZES = { md: 24, lg: 40 };

// Circular indeterminate progress (docs/ui-guideline.md §4.11): a --pw-tab
// arc with a 3px stroke, 24px (size="md", default) or 40px (size="lg").
// `label` names it for screen readers; pass label={null} when the text around
// it already says what is loading.
export default function Spinner({ size = 'md', label = 'Memuat', className = '' }) {
  const px = SIZES[size] || SIZES.md;
  const r = (px - 3) / 2;
  const a11y = label ? { role: 'progressbar', 'aria-label': label } : { 'aria-hidden': 'true' };
  return (
    <span className={['pw-spinner', `pw-spinner--${size === 'lg' ? 'lg' : 'md'}`, className].filter(Boolean).join(' ')} {...a11y}>
      <svg className="pw-spinner__svg" viewBox={`0 0 ${px} ${px}`} width={px} height={px} focusable="false">
        <circle className="pw-spinner__arc" cx={px / 2} cy={px / 2} r={r} pathLength="100" />
      </svg>
    </span>
  );
}
