import { forwardRef, useLayoutEffect, useRef } from 'react';
import { mergeRefs } from './choiceParts';
import { AiFilledTag } from './fieldParts';
import './choice.css';

// Checkbox (docs/ui-guideline.md §4.5): 20×20 box, radius 3, 2px border; checked
// fills with --pw-accent and a white check. A real <input type="checkbox"> sits
// on the round 40px touch area, so forms, keyboard and screen readers work as
// usual. `label` (or children) is the visible text; without it pass aria-label.
// `indeterminate` shows the mixed state (select-all with part of the rows).
// `data` marks the label as record data (a product, person or file name) that
// the language switch never translates.
const Checkbox = forwardRef(function Checkbox({ label, children, indeterminate = false, data = false, aiFilled = false, className = '', disabled, ...props }, ref) {
  const own = useRef(null);
  useLayoutEffect(() => { if (own.current) own.current.indeterminate = Boolean(indeterminate); }, [indeterminate]);
  const text = label ?? children;
  return (
    <label className={['pw-choice', 'pw-checkbox', disabled ? 'is-disabled' : '', text ? '' : 'pw-choice--bare', aiFilled ? 'is-ai-filled' : '', className].filter(Boolean).join(' ')}>
      <span className="pw-choice__touch pw-state-layer">
        <input ref={mergeRefs(own, ref)} type="checkbox" className="pw-choice__input" disabled={disabled} {...props} />
        <span className="pw-checkbox__box" aria-hidden="true">
          <svg className="pw-checkbox__mark" viewBox="0 0 24 24" focusable="false"><path d="M1.73 12.91 8.1 19.28 22.79 4.59" /></svg>
          <span className="pw-checkbox__mixed" />
        </span>
      </span>
      {text ? <span className="pw-choice__label" data-no-translate={data ? '' : undefined}>{text}</span> : null}
      {aiFilled ? <AiFilledTag /> : null}
    </label>
  );
});

export default Checkbox;
