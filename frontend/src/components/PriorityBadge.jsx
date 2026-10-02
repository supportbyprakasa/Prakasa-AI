import Badge from './Badge';
import { priorityLabel, priorityTone } from './statusTone';

// Priority / severity as coloured text (docs/ui-guideline.md §4.12): Rendah and
// Normal neutral, Tinggi warning, Mendesak and Kritis error.
export default function PriorityBadge({ priority, label }) {
  return <Badge tone={priorityTone(priority)} className="pw-status" translate>{label || priorityLabel(priority)}</Badge>;
}
