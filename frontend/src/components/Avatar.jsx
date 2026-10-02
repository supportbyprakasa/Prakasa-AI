import { useEffect, useState } from 'react';
import Icon from './Icon';
import './avatar.css';

// The one avatar (docs/ui-guideline.md §4.12): a token-colour circle with white
// Roboto 500 initials, or the person's photo. Used by the top bar account
// button, the app launcher, the AI account menu and the Google pages
// (GoogleAvatar). A photo that fails to load falls back to the initials.
//
//   size   sm 24 | md 32 | lg 40
//   tone   'primary' (default) | 'auto' — a colour picked from a hash of
//          `name`, so a person keeps the same colour everywhere (Chat, Gmail,
//          Groups)
//   icon   a Material Symbols name shown instead of initials (a group, a bot)
//   shape  'circle' | 'tile' (rounded square, a Chat space)
//   muted  the grey look of a deleted account
// Decorative (aria-hidden): the control or text next to it names the person.
const SIZES = new Set(['sm', 'md', 'lg']);
const TINTS = 6;

export function avatarInitials(name) {
  // "[UJI] Warehouse Head" → "UH": first and last word, letters/digits only.
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join('').toUpperCase();
}

// Deterministic colour slot (0–5) from a name.
export function avatarTint(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % TINTS;
}

export default function Avatar({
  name = '', src, size = 'md', tone = 'primary', icon, shape = 'circle', muted = false, className = '',
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const tint = tone === 'auto' ? avatarTint(name) : 0;
  const classes = [
    'pw-avatar', `pw-avatar--${SIZES.has(size) ? size : 'md'}`,
    shape === 'tile' ? 'pw-avatar--tile' : '',
    muted ? 'pw-avatar--muted' : `pw-avatar--tint-${tint}`,
    className,
  ].filter(Boolean).join(' ');
  let content;
  if (src && !failed) content = <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  else if (icon) content = <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />;
  else content = avatarInitials(name);
  // Initials come from a person's name: record data, never translated.
  return <span className={classes} aria-hidden="true" data-no-translate="">{content}</span>;
}
