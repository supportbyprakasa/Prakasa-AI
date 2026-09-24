import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function AIDropdown({
  icon: Icon,
  label,
  ariaLabel,
  items,
  value,
  onSelect,
  disabled = false,
  align = 'left',
  placement = 'top',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`ai-dropdown is-${placement} is-${align}`} ref={rootRef}>
      <button
        type="button"
        className="ai-chip-button ai-ripple"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {Icon && <Icon size={15} />}
        <span className="ai-chip-label">{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="ai-menu" role="menu" aria-label={ariaLabel}>
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === value}
              className="ai-menu-item ai-ripple"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                if (item.value !== value) onSelect(item.value);
              }}
            >
              <span className="ai-menu-item-text">
                <strong>{item.label}</strong>
                {item.description && <small>{item.description}</small>}
              </span>
              {item.value === value && <Check size={16} className="ai-menu-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
