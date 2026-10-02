import { toneClass } from './ganttModel';
import './gantt.css';

// Swatch colours come from the same status tones the bars use (ganttModel.toneClass).
const STATUS_ITEMS = [
  { status: 'open', label: 'Belum dimulai' },
  { status: 'in_progress', label: 'Dikerjakan' },
  { status: 'review', label: 'Ditinjau' },
  { status: 'done', label: 'Selesai' },
  { status: 'cancelled', label: 'Dibatalkan' },
];

// A legend must only explain what the chart can actually show: pass the
// statuses a page emits, and showLinks only when dependency arrows exist.
export default function GanttLegend({ statuses = null, showLinks = false }) {
  const items = statuses ? STATUS_ITEMS.filter((item) => statuses.includes(item.status)) : STATUS_ITEMS;
  return (
    <ul className="gantt-legend" aria-label="Keterangan warna">
      {items.map((item) => (
        <li key={item.status} className="gantt-legend__item">
          <span className={`gantt-legend__swatch ${toneClass(item.status)}`} aria-hidden="true" />
          <span>{item.label}</span>
        </li>
      ))}
      <li className="gantt-legend__item">
        <span className="gantt-legend__swatch gantt-legend__swatch--estimated" aria-hidden="true" />
        <span>Tanggal estimasi</span>
      </li>
      {showLinks ? (
        <>
          <li className="gantt-legend__item">
            <svg width="24" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="24" y2="4" className="gantt__link gantt__link--blocks" />
            </svg>
            <span>Menghalangi</span>
          </li>
          <li className="gantt-legend__item">
            <svg width="24" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="24" y2="4" className="gantt__link gantt__link--related" />
            </svg>
            <span>Terkait</span>
          </li>
        </>
      ) : null}
    </ul>
  );
}
