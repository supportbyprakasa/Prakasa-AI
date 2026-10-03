import { FieldShell } from './fieldParts';

// For controls that aren't a plain input/select/textarea (checkbox group, file
// picker, user picker…): a small label above (12px, like a floated label), the
// control, and the same hint / error block as the other fields.
export default function Field({ label, htmlFor, required, hint, error, className = '', aiFilled = false, children }) {
  const id = htmlFor;
  return (
    <FieldShell kind="static" id={id} label={label} required={required} hint={hint} error={error} hintId={id ? `${id}-hint` : undefined} errorId={id ? `${id}-error` : undefined} className={className} aiFilled={aiFilled}>
      {children}
    </FieldShell>
  );
}
