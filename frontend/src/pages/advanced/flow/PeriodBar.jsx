import Chip from '../../../components/Chip';
import { PERIOD_PRESETS, periodText } from '../managementFlowModel';

// The period of the sales, purchase and margin tabs (?period=), with the dates
// the server resolved it to (WIB). Filters for the whole tab (the margin's
// division) come as children, on the same wrapping row.
export default function PeriodBar({ value, onChange, period, children }) {
  return (
    <div className="mflow-bar">
      <div className="pw-row" role="group" aria-label="Periode">
        {PERIOD_PRESETS.map((p) => <Chip key={p.key} selected={value === p.key} onClick={() => onChange(p.key)}>{p.label}</Chip>)}
      </div>
      {period ? <span className="pw-text-helper">{periodText(period)}</span> : null}
      {children}
    </div>
  );
}
