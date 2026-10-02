import { forwardRef } from 'react';
import { AiFilledTag } from './fieldParts';
import './choice.css';

// Switch (docs/ui-guideline.md §4.5, sementara): track 34×14, thumb 20. On: the
// thumb is --pw-accent on a 50% accent track; off: a white raised thumb on a
// grey track. A real <input type="checkbox" role="switch"> underneath.
const Switch = forwardRef(function Switch({ label, children, aiFilled = false, className = '', disabled, ...props }, ref) {
  const text = label ?? children;
  return (
    <label className={['pw-choice', 'pw-switch', disabled ? 'is-disabled' : '', text ? '' : 'pw-choice--bare', aiFilled ? 'is-ai-filled' : '', className].filter(Boolean).join(' ')}>
      <span className="pw-switch__control">
        <input ref={ref} type="checkbox" role="switch" className="pw-choice__input" disabled={disabled} {...props} />
        <span className="pw-switch__track" aria-hidden="true" />
        <span className="pw-choice__touch pw-state-layer" aria-hidden="true"><span className="pw-switch__thumb" /></span>
      </span>
      {text ? <span className="pw-choice__label">{text}</span> : null}
      {aiFilled ? <AiFilledTag /> : null}
    </label>
  );
});

export default Switch;
