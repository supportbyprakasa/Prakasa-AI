import { useId, useRef, useState } from 'react';
import Icon from './Icon';
import IconButton from './IconButton';
import Menu from './Menu';

// "⋮" overflow menu for rows, cards and detail headers with more than two
// actions (docs/ui-guideline.md §3.2, §4.14).
// items: [{ label, icon, onClick, tone: 'danger', disabled, divider }]; `icon`
// is a Material Symbols name (a lucide component still works).
export default function ActionMenu({ items, label = 'Aksi lainnya', align = 'end', size }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuId = useId();

  const visible = (items || []).filter(Boolean);
  if (!visible.length) return null;
  return (
    <>
      <IconButton
        ref={anchorRef}
        label={label}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more_vert" />
      </IconButton>
      <Menu
        id={menuId}
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        items={visible}
        align={align}
        label={label}
      />
    </>
  );
}
