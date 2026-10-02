import DateInput from '../DateInput';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Segmented from '../Segmented';
import Spinner from '../Spinner';
import './gantt.css';

const ZOOMS = [
  { value: 'week', label: 'Minggu' },
  { value: 'month', label: 'Bulan' },
];

// Date window + zoom for a Gantt page. It used to carry Department/Board/Entity
// ID fields for the old Timeline page; the only caller left (Peta Program)
// scopes itself from the account, so those would be editable filters that do
// nothing. A page that needs extra controls passes them as children (they sit
// after the zoom). The zoom switch shows only with onZoomChange, so a list view
// can leave it out.
export default function GanttToolbar({
  filters, onChange, onRefresh, loading, zoom, onZoomChange, children,
}) {
  const set = (k, v) => onChange({ ...filters, [k]: v });

  return (
    <div className="gantt-toolbar">
      <div className="gantt-toolbar__fields">
        <DateInput
          label="Dari"
          value={filters.from}
          onChange={(e) => set('from', e.target.value)}
        />
        <DateInput
          label="Sampai"
          value={filters.to}
          onChange={(e) => set('to', e.target.value)}
        />
      </div>

      <div className="gantt-toolbar__end">
        {onZoomChange ? (
          <Segmented options={ZOOMS} value={zoom} onChange={onZoomChange} label="Skala linimasa" />
        ) : null}
        {children}
        {/* Optional: a page that already has a "Muat ulang" button in its header
            should not get a second control doing the same thing. */}
        {onRefresh ? (
          <IconButton label="Muat ulang" onClick={onRefresh} disabled={loading} aria-busy={loading || undefined}>
            {loading ? <Spinner label={null} /> : <Icon name="refresh" />}
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
