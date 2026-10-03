import { forwardRef } from 'react';
import { FieldShell, describedBy, hasLabel, useFieldIds } from './fieldParts';

// Underlined multi-line field with a floating label (§4.3).
const Textarea = forwardRef(function Textarea({ label, error, hint, className = '', fieldClassName = '', rows = 4, dense = false, mono = false, aiFilled = false, ...props }, ref) {
  const { id, hintId, errorId } = useFieldIds(props);
  const floating = hasLabel(label) && !dense;
  return (
    <FieldShell
      id={id} label={label} required={props.required} hint={hint} error={error} hintId={hintId} errorId={errorId}
      className={fieldClassName} kind="textarea" dense={dense} disabled={props.disabled} aiFilled={aiFilled}
    >
      <textarea
        ref={ref}
        rows={rows}
        {...props}
        id={id}
        placeholder={floating ? (props.placeholder || ' ') : props.placeholder}
        className={['pw-field__input', mono ? 'pw-field__input--mono' : '', className].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy({ hint, error, hintId, errorId, extra: props['aria-describedby'] })}
      />
    </FieldShell>
  );
});

export default Textarea;
