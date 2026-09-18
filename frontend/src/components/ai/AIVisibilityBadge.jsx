import { Lock, Users, Building2 } from 'lucide-react';
import Badge from '../Badge';

/**
 * Display session visibility with clear helper text.
 * Frontend presentation only — backend enforces actual access.
 */

const VIS_META = {
  private: {
    label: 'Private',
    tone: 'default',
    icon: Lock,
    helper: 'Hanya Anda, kecuali audit terotorisasi.',
  },
  department: {
    label: 'Department',
    tone: 'info',
    icon: Users,
    helper: 'Dibagikan sesuai akses department.',
  },
  entity: {
    label: 'Entity',
    tone: 'warning',
    icon: Building2,
    helper: 'Dibagikan sesuai akses entity.',
  },
};

export function visibilityLabel(v) {
  return (VIS_META[v] || VIS_META.private).label;
}

export function visibilityHelper(v) {
  return (VIS_META[v] || VIS_META.private).helper;
}

export default function AIVisibilityBadge({ visibility, showIcon = true }) {
  const meta = VIS_META[visibility] || VIS_META.private;
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      {showIcon && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon size={11} />
          {meta.label}
        </span>
      )}
      {!showIcon && meta.label}
    </Badge>
  );
}