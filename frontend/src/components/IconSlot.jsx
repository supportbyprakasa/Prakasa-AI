import { isValidElement } from 'react';
import Icon from './Icon';
import { LUCIDE_TO_SYMBOL } from './iconMap';

const PX = { sm: 18, md: 20, lg: 24, xl: 48 };

// An `icon` prop of a shared component may be a Material Symbols name
// ("inbox"), a ready element, or — from pages not migrated yet — a lucide
// component. Lucide components are translated through LUCIDE_TO_SYMBOL so
// every shared component shows Material Symbols (docs/ui-guideline.md §1.11).
export default function IconSlot({ icon, size = 'lg', className = '' }) {
  if (!icon) return null;
  if (typeof icon === 'string') return <Icon name={icon} size={size} className={className} />;
  if (isValidElement(icon)) return icon;
  const symbol = LUCIDE_TO_SYMBOL[icon.displayName];
  if (symbol) return <Icon name={symbol} size={size} className={className} />;
  const Glyph = icon;
  return <Glyph size={PX[size] || PX.lg} aria-hidden="true" className={className} />;
}
