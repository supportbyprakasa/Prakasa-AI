import { useEffect, useState } from 'react';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import SearchField from '../../components/SearchField';
import Select from '../../components/Select';
import { PRIORITY_LABELS } from '../../components/statusTone';
import { ISSUE_TYPES, PRIORITIES, hasActiveFilters } from './trackerModel';

// The filter bar above every view (board, backlog, list): one search and the
// assignee / type / priority / label pickers as dense fields, like the filter
// bar of an admin console table. Values live in the URL (the parent owns them).
export default function TrackerFilters({ filters, members, labels, onChange, compact = false }) {
  const [q, setQ] = useState(filters.q || '');
  const activeCount = ['assignee', 'type', 'priority', 'label'].filter((k) => filters[k]).length;
  const [expanded, setExpanded] = useState(activeCount > 0);
  const showFields = !compact || expanded;
  useEffect(() => { setQ(filters.q || ''); }, [filters.q]);
  useEffect(() => {
    if (q === (filters.q || '')) return undefined;
    const timer = setTimeout(() => onChange({ q }), 300);
    return () => clearTimeout(timer);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const assigneeOptions = [
    { value: 'me', label: 'Saya', translate: true },
    { value: 'none', label: 'Belum ditugaskan', translate: true },
    ...(members || []).map((m) => ({ value: m.email, label: m.name || m.email })),
  ];
  const labelOptions = [...new Set([...(labels || []), ...(filters.label ? [filters.label] : [])])].map((l) => ({ value: l, label: l }));

  return (
    <div className={`tracker-filters${compact ? ' tracker-filters--compact' : ''}`} role="group" aria-label="Filter issue">
      <SearchField
        className="tracker-filters__search"
        label="Cari issue"
        placeholder="Cari judul atau kunci"
        value={q}
        maxLength={190}
        onChange={(e) => setQ(e.target.value)}
      />
      {compact ? (
        <Chip selected={expanded} icon="tune" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {activeCount ? `Filter (${activeCount})` : 'Filter'}
        </Chip>
      ) : null}
      {showFields ? (
        <>
          <Select dense label="Penanggung jawab" value={filters.assignee || ''} onChange={(e) => onChange({ assignee: e.target.value })} placeholder="Semua orang" options={assigneeOptions} dataOptions fieldClassName="tracker-filters__field" />
          <Select dense label="Tipe" value={filters.type || ''} onChange={(e) => onChange({ type: e.target.value })} placeholder="Semua tipe" options={ISSUE_TYPES} fieldClassName="tracker-filters__field" />
          <Select dense label="Prioritas" value={filters.priority || ''} onChange={(e) => onChange({ priority: e.target.value })} placeholder="Semua prioritas" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} fieldClassName="tracker-filters__field" />
          <Select dense label="Label" value={filters.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Semua label" options={labelOptions} dataOptions fieldClassName="tracker-filters__field" />
        </>
      ) : null}
      {hasActiveFilters(filters) ? (
        <Button variant="text" icon="close" onClick={() => { setQ(''); onChange({ q: '', assignee: '', type: '', priority: '', label: '' }); }}>
          Hapus filter
        </Button>
      ) : null}
    </div>
  );
}
