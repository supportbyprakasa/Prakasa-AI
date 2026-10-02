import { useId, useRef, useState } from 'react';
import Chip from './Chip';
import Menu from './Menu';

// A filter chip in a DataGrid filter bar that picks one value from a menu
// ("Periode: Bulan ini"), the admin console's applied-filter chip. Built from
// the shared Chip and Menu; it is marked selected while it holds anything
// other than its default. options: [{ value, label }].
// `dataOptions`: the options are record data (warehouse, salesperson,
// customer names …) and are never translated; an option can opt back in with
// `translate: true` ("Semua gudang").
export default function FilterMenuChip({
  label, value, options, onChange, icon, defaultValue = '', dataOptions = false,
}) {
  const isData = (option) => Boolean(option && (option.data ?? (dataOptions && !option.translate)));
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuId = useId();
  const current = options.find((option) => option.value === value) || options.find((option) => option.value === defaultValue);
  return (
    <span ref={anchorRef} className="pw-row">
      {/* A menu button, not a toggle: the selected look without aria-pressed. */}
      <Chip
        icon={icon}
        className={value !== defaultValue ? 'is-selected' : ''}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((next) => !next)}
      >
        {label}: <span data-no-translate={isData(current) ? '' : undefined}>{current?.label ?? '—'}</span>
      </Chip>
      <Menu
        id={menuId}
        open={open}
        anchorRef={anchorRef}
        align="start"
        label={label}
        onClose={() => setOpen(false)}
        items={options.map((option) => ({
          key: String(option.value || 'semua'),
          label: option.label,
          data: isData(option),
          icon: option.value === value ? 'radio_button_checked' : 'radio_button_unchecked',
          onClick: () => { if (option.value !== value) onChange(option.value); },
        }))}
      />
    </span>
  );
}
