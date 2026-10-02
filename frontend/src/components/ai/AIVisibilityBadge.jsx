import Icon from '../Icon';
import StatusBadge from '../StatusBadge';
import './ai-components.css';

/**
 * Display session visibility with clear helper text.
 * Frontend presentation only — backend enforces actual access.
 * The tone comes from statusTone.js (visibility is a category, so neutral);
 * only the label, icon and helper text live here.
 */

const VIS_META = {
  private: {
    label: 'Pribadi',
    icon: 'lock',
    helper: 'Hanya Anda yang dapat membaca isi percakapan.'
  },
  department: {
    label: 'Divisi',
    icon: 'group',
    helper: 'Dibagikan sesuai akses divisi.',
  },
  entity: {
    label: 'Lintas divisi',
    icon: 'domain',
    helper: 'Dibagikan sesuai akses entitas.',
  },
};

export function visibilityLabel(v) {
  return (VIS_META[v] || VIS_META.private).label;
}

export function visibilityHelper(v) {
  return (VIS_META[v] || VIS_META.private).helper;
}

// "Pribadi — Hanya Anda yang …" options for the visibility Select.
export function visibilityOptions() {
  return Object.keys(VIS_META).map((value) => ({ value, label: `${VIS_META[value].label} — ${VIS_META[value].helper}` }));
}

export default function AIVisibilityBadge({ visibility, showIcon = true }) {
  const key = VIS_META[visibility] ? visibility : 'private';
  const meta = VIS_META[key];
  return (
    <StatusBadge
      status={key}
      label={showIcon ? (
        <span className="ai-visibility-label">
          <Icon name={meta.icon} size="sm" />
          {meta.label}
        </span>
      ) : meta.label}
    />
  );
}
