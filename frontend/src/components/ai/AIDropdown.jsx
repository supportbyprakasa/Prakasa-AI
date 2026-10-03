import { useId, useRef, useState } from 'react';
import Chip from '../Chip';
import Menu from '../Menu';

// A chip that opens a single-choice menu (engine, visibility, division): the
// shared Chip with a trailing arrow_drop_down and the shared Menu with
// menuitemradio items (docs/ui-guideline.md §4.6, §4.14). `icon` is a Material
// Symbols name. placement="top" (default, the composer at the bottom of the
// page) opens the menu above the chip when there is room.
export default function AIDropdown({
  icon,
  label,
  ariaLabel,
  items,
  value,
  onSelect,
  disabled = false,
  align = 'left',
  placement = 'top',
  // The chip's label is record data (an engine and its model, a division).
  dataLabel = false,
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuId = useId();

  return (
    <div className="ai-dropdown">
      <Chip
        ref={anchorRef}
        className="ai-chip-button"
        icon={icon}
        trailingIcon="arrow_drop_down"
        tooltip={open || disabled ? undefined : ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        data={dataLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </Chip>
      <Menu
        id={menuId}
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        label={ariaLabel}
        align={align === 'right' ? 'end' : 'start'}
        placement={placement}
        items={items.map((item) => ({
          key: String(item.value),
          label: item.label,
          description: item.description,
          data: item.data,
          dataDescription: item.dataDescription,
          disabled: item.disabled,
          checked: item.value === value,
          onClick: () => { if (item.value !== value) onSelect(item.value); },
        }))}
      />
    </div>
  );
}
