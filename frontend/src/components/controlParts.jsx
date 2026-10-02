import { isValidElement, useId } from 'react';
import Icon from './Icon';

// Shared pieces of the control components (Button, IconButton, Chip, TabBar,
// Segmented). `icon` may be a Material Symbols name ("add"), an element, or an
// older lucide component — the last two keep existing pages working until they
// move to symbol names (docs/ui-guideline.md §1.11).
export function ControlIcon({ icon, size = 'lg', legacySize = 24 }) {
  if (!icon) return null;
  if (typeof icon === 'string') return <Icon name={icon} size={size} />;
  if (isValidElement(icon)) return icon;
  const Legacy = icon;
  return <Legacy size={legacySize} aria-hidden="true" focusable="false" />;
}

// A tooltip on a labelled control (Button, Chip) is extra information, so it is
// also the control's accessible description: a visually hidden sibling that
// the control points at (inside the control it would join the accessible
// name). `title` from older pages becomes the tooltip — the native title box
// is not used (docs/ui-guideline.md §4.14). `placement` "right" opens the
// bubble beside the control instead of below it (components/tooltip.js).
export function useTooltip(tooltip, title, describedBy, placement) {
  const id = `${useId()}-tip`;
  const text = tooltip ?? title;
  if (!text) return { props: describedBy ? { 'aria-describedby': describedBy } : {}, node: null };
  return {
    props: {
      'data-pw-tooltip': text,
      'data-pw-tooltip-placement': placement === 'right' ? 'right' : undefined,
      'aria-describedby': [describedBy, id].filter(Boolean).join(' '),
    },
    node: <span id={id} className="pw-visually-hidden">{text}</span>,
  };
}
