import { useLayoutEffect, useRef, useState } from 'react';
import IconButton from '../../../components/IconButton';
import { REACTION_EMOJI } from '../chatModel';
import { useDismiss } from './parts';

// Small reaction picker: the common unicode emoji the backend also whitelists.
// A grid of choices, not a list of actions, so it stays a local popover
// (shared Menu renders one column of 48px text items).
export default function EmojiPicker({ onPick, size = 'sm', label = 'Tambahkan reaksi' }) {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  const pickerRef = useRef(null);

  // Flip upward when the scrolling message list would clip the picker.
  useLayoutEffect(() => {
    if (!open) { setUpward(false); return; }
    const picker = pickerRef.current?.getBoundingClientRect();
    const box = ref.current?.closest('.pw-gchat__messages')?.getBoundingClientRect();
    if (picker && box && picker.bottom > box.bottom) setUpward(true);
  }, [open, ref]);

  const toggle = () => setOpen((v) => !v);
  return (
    <div className="pw-gchat__emoji-anchor" ref={ref}>
      <IconButton size={size} label={label} icon="add_reaction" aria-haspopup="dialog" aria-expanded={open} onClick={toggle} />
      {open ? (
        <div ref={pickerRef} className={`pw-gchat__emoji-picker${upward ? ' is-upward' : ''}`} role="dialog" aria-label="Pilih reaksi">
          {REACTION_EMOJI.map(({ emoji, label: name }) => (
            <IconButton key={emoji} size="sm" label={name} className="pw-gchat__emoji" onClick={() => { setOpen(false); onPick(emoji); }}>
              <span aria-hidden="true">{emoji}</span>
            </IconButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}
