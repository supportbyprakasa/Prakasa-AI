import { forwardRef } from 'react';
import Icon from './Icon';
import { FieldShell, alwaysFloats, describedBy, hasLabel, useFieldIds } from './fieldParts';

// Underlined field with a floating label (docs/ui-guideline.md §4.3). The label
// rests on the input line while the field is empty and floats (12px) on focus
// or once there is a value; a placeholder shows only while the label floats.
// `dense`: 36px for table cells and the pager, the label is kept for screen
// readers only. `mono`: code-like values.
const PICKER_ICONS = { date: 'calendar_today', 'datetime-local': 'calendar_today', month: 'calendar_today', week: 'calendar_today', time: 'schedule' };

const Input = forwardRef(function Input({ label, error, hint, className = '', fieldClassName = '', dense = false, mono = false, aiFilled = false, ...props }, ref) {
  const { id, hintId, errorId } = useFieldIds(props);
  const floating = hasLabel(label) && !dense;
  const picker = PICKER_ICONS[props.type];
  return (
    <FieldShell
      id={id} label={label} required={props.required} hint={hint} error={error} hintId={hintId} errorId={errorId}
      className={fieldClassName} kind="input" dense={dense} floated={alwaysFloats(props.type)} disabled={props.disabled} aiFilled={aiFilled}
      trailing={picker ? <Icon name={picker} /> : null}
    >
      <input
        ref={ref}
        {...props}
        id={id}
        // A placeholder (at least a space) lets CSS see an empty field (:placeholder-shown).
        placeholder={floating ? (props.placeholder || ' ') : props.placeholder}
        className={['pw-field__input', mono ? 'pw-field__input--mono' : '', className].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy({ hint, error, hintId, errorId, extra: props['aria-describedby'] })}
      />
    </FieldShell>
  );
});

export default Input;
