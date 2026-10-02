import { forwardRef } from 'react';
import { AiFilledTag } from './fieldParts';
import './choice.css';

// Radio (docs/ui-guideline.md §4.5): 20×20 circle, 2px border; selected turns
// --pw-tab with a 10px dot. Touch area 28 (40 on phones). A real
// <input type="radio"> keeps arrow-key movement inside a group (same `name`).
const Radio = forwardRef(function Radio({ label, children, aiFilled = false, className = '', disabled, ...props }, ref) {
  const text = label ?? children;
  return (
    <label className={['pw-choice', 'pw-radio', disabled ? 'is-disabled' : '', text ? '' : 'pw-choice--bare', aiFilled ? 'is-ai-filled' : '', className].filter(Boolean).join(' ')}>
      <span className="pw-choice__touch pw-state-layer">
        <input ref={ref} type="radio" className="pw-choice__input" disabled={disabled} {...props} />
        <span className="pw-radio__circle" aria-hidden="true" />
      </span>
      {text ? <span className="pw-choice__label">{text}</span> : null}
      {aiFilled ? <AiFilledTag /> : null}
    </label>
  );
});

export default Radio;
