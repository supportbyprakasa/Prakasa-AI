import { forwardRef } from 'react';
import { ControlIcon, useTooltip } from './controlParts';
import './chip.css';

// 32px pill (docs/ui-guideline.md §4.6). Filter chip: `selected` toggles
// aria-pressed; a count is written in the label ("Menunggu (3)").
// variant="add": the dashed "Tambah filter" chip (icon defaults to "add").
// `icon` takes a Material Symbols name (older pages pass a lucide component).
// `trailingIcon` adds an icon after the label, e.g. "arrow_drop_down" on a chip
// that opens a menu. `tooltip` (or an old `title`) becomes the shared tooltip
// (tooltipPlacement="right" opens it beside the chip). The ref reaches the
// <button> (a Menu anchor).
// `data` marks the label as record data (a customer, item, warehouse or
// person name) that the language switch never translates.
const Chip = forwardRef(function Chip({
  selected, icon, trailingIcon, variant = 'filter', tooltip, tooltipPlacement, title, data = false, children, className = '', ...props
}, ref) {
  const add = variant === 'add';
  const pressed = add || selected === undefined ? undefined : Boolean(selected);
  const leading = icon ?? (add ? 'add' : null);
  const tip = useTooltip(tooltip, title, props['aria-describedby'], tooltipPlacement);
  const classes = [
    'pw-chip', 'pw-state-layer', add ? 'pw-chip--add' : '', leading ? 'pw-chip--icon' : '',
    trailingIcon ? 'pw-chip--trailing' : '', pressed ? 'is-selected' : '', className,
  ].filter(Boolean).join(' ');
  return (
    <>
      <button ref={ref} type="button" aria-pressed={pressed} {...props} {...tip.props} className={classes}>
        <ControlIcon icon={leading} legacySize={20} />
        <span className="pw-chip__label" data-no-translate={data ? '' : undefined}>{children}</span>
        {trailingIcon ? <span className="pw-chip__trailing" aria-hidden="true"><ControlIcon icon={trailingIcon} legacySize={20} /></span> : null}
      </button>
      {tip.node}
    </>
  );
});

export default Chip;
