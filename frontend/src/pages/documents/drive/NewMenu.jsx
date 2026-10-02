import { useId, useRef, useState } from 'react';
import Button from '../../../components/Button';
import Menu from '../../../components/Menu';
import './drive.css';

// The Drive browser's one primary action: "Buat baru" opens a menu of what can
// be created (folder, upload, Dokumen, Spreadsheet, Slide), like Drive's
// "+ Baru". items: Menu items ({ label, icon, onClick, divider }).
export default function NewMenu({ items, label = 'Buat baru', loading = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuId = useId();
  return (
    <span ref={anchorRef} className="drive-new">
      <Button
        icon="add"
        loading={loading}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      <Menu id={menuId} open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} items={items} align="end" label={label} />
    </span>
  );
}
