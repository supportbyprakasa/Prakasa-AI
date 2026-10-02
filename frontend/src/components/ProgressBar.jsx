import './progress-bar.css';

// Linear progress (docs/ui-guideline.md §4.11): 4px, track --pw-selected, fill
// --pw-tab, square ends. `value` of `max`; without a value it runs as an
// indeterminate bar. `tone="error"` marks a figure that is off track. `label`
// names the bar for screen readers.
// `dataLabel`: the label names a record (a location, a customer), so it is
// never translated.
export default function ProgressBar({ value, max = 100, label, dataLabel = false, tone = 'default', className = '' }) {
  const indeterminate = value === null || value === undefined || Number.isNaN(Number(value));
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, (Number(value) / (Number(max) || 100)) * 100));
  const classes = ['pw-progress', indeterminate ? 'pw-progress--indeterminate' : '', tone === 'error' ? 'pw-progress--error' : '', className]
    .filter(Boolean).join(' ');
  return (
    <div
      className={classes}
      role="progressbar"
      aria-label={label}
      data-no-translate={dataLabel ? '' : undefined}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div className="pw-progress__fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
