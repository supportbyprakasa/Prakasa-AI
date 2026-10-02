import { useId } from 'react';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { formatNumber } from '../format';
import { pageRange } from './gridModel';
import './pager.css';

// Admin console pagination bar (docs/ui-guideline.md §4.9 item 5): 57px,
// "Baris per halaman:" with a 56×46 dropdown, "a–b dari N" (Material data
// table), "Halaman x dari y" and four 48px icon buttons. DataGrid uses it for client and server paging alike; any other
// list (notifications…) imports it too.
//
//   page            current page, 1-based
//   pageCount       number of pages (at least 1)
//   onPageChange    (page) => void
//   pageSize        rows per page, shown in the dropdown
//   pageSizes       dropdown choices; the dropdown only shows with onPageSizeChange
//   onPageSizeChange(size) => void
//   total           number of rows in the whole list; shows "a–b dari N"
export default function Pager({
  page = 1,
  pageCount = 1,
  onPageChange,
  pageSize,
  pageSizes,
  onPageSizeChange,
  total,
  disabled = false,
  label = 'Paginasi',
  className = '',
}) {
  const selectId = useId();
  const last = Math.max(1, Number(pageCount) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), last);
  const go = (target) => { if (target !== current) onPageChange?.(target); };
  const atStart = disabled || current <= 1;
  const atEnd = disabled || current >= last;
  const showSize = Boolean(onPageSizeChange && pageSizes?.length);
  const hasTotal = total !== undefined && total !== null && Number.isFinite(Number(total)) && Number(pageSize) > 0;
  const range = hasTotal ? pageRange(current, pageSize, total) : null;

  return (
    <nav className={['pw-pager', className].filter(Boolean).join(' ')} aria-label={label}>
      {showSize ? (
        <div className="pw-pager__size">
          <label className="pw-pager__label" htmlFor={selectId}>Baris per halaman:</label>
          <span className="pw-pager__select pw-state-layer">
            <select
              id={selectId}
              value={pageSize}
              disabled={disabled}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <Icon name="arrow_drop_down" className="pw-pager__arrow" />
          </span>
        </div>
      ) : null}
      {range ? (
        <span className="pw-pager__range">
          {range.total ? `${formatNumber(range.from)}–${formatNumber(range.to)}` : '0'} dari {formatNumber(range.total)}
        </span>
      ) : null}
      <span className="pw-pager__status" aria-live="polite">Halaman {current} dari {last}</span>
      <div className="pw-pager__nav">
        <IconButton label="Halaman pertama" className="pw-pager__edge" disabled={atStart} onClick={() => go(1)}>
          <Icon name="first_page" />
        </IconButton>
        <IconButton label="Halaman sebelumnya" disabled={atStart} onClick={() => go(current - 1)}>
          <Icon name="chevron_left" />
        </IconButton>
        <IconButton label="Halaman berikutnya" disabled={atEnd} onClick={() => go(current + 1)}>
          <Icon name="chevron_right" />
        </IconButton>
        <IconButton label="Halaman terakhir" className="pw-pager__edge" disabled={atEnd} onClick={() => go(last)}>
          <Icon name="last_page" />
        </IconButton>
      </div>
    </nav>
  );
}
