import Badge from './Badge';
import { statusLabel, statusTone } from './statusTone';

// <StatusBadge status="pending_approval" /> — coloured status text; tone and
// Indonesian label from the one map (docs/ui-guideline.md §4.12). Pass `label`
// to override the text (a module-specific wording); the tone never changes.
export default function StatusBadge({ status, label }) {
  // A status label is interface text even inside a record-data zone.
  return <Badge tone={statusTone(status)} className="pw-status" translate>{label || statusLabel(status)}</Badge>;
}
