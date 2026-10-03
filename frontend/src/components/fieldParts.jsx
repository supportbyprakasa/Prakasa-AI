import { useId } from 'react';

// Shared wiring for every field (docs/ui-guideline.md §4.3): stable id, the
// generation A frame (underline + floating label), and a hint that an error
// replaces.
export function useFieldIds(props) {
  const generatedId = useId();
  const id = props.id || props.name || generatedId;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

export function describedBy({ hint, error, hintId, errorId, extra }) {
  return [error ? errorId : hint ? hintId : null, extra].filter(Boolean).join(' ') || undefined;
}

// Inputs whose browser UI always shows something (dd/mm/yyyy, a file button):
// their label never rests on the input line.
const ALWAYS_FLOATED = new Set(['date', 'datetime-local', 'month', 'week', 'time', 'file', 'color', 'range']);
export const alwaysFloats = (type) => ALWAYS_FLOATED.has(type);

export const hasLabel = (label) => label !== undefined && label !== null && label !== false && label !== '';

// "Nama *": the required mark is part of the label text, in the label colour.
// Screen readers get `required` from the control itself.
function labelText(label, required) {
  if (!required || (typeof label === 'string' && /\*\s*$/.test(label))) return label;
  return <>{label}<span className="pw-field__required" aria-hidden="true"> *</span></>;
}

function Assist({ hint, error, hintId, errorId }) {
  return (
    <div className="pw-field__assist">
      {error
        ? <span id={errorId} className="pw-field__error" role="alert">{error}</span>
        : hint ? <span id={hintId} className="pw-field__hint">{hint}</span> : null}
    </div>
  );
}

// "diisi AI": the mark on a control whose value Prakasa AI put there and the
// user has not reviewed yet (Wave C, docs/prakasa-ai-rencana.md §9.8). Every
// control that takes `aiFilled` shows this same tag; a form gets the prop from
// usePrakasaAIForm: <Input {...ai.field('title')} … />.
export function AiFilledTag({ className = '' }) {
  return <span className={['pw-ai-tag', className].filter(Boolean).join(' ')}>diisi AI</span>;
}

// kind: input | select | textarea (underlined, floating label) or static (a
// label above any other control — Field). The label comes after the control
// in the DOM so CSS can float it from the control's own state.
export function FieldShell({
  id, label, required, hint, error, hintId, errorId, className = '', children,
  kind = 'input', dense = false, floated = false, disabled = false, trailing = null, aiFilled = false,
}) {
  const labelled = hasLabel(label);
  const classes = [
    'pw-field', `pw-field--${kind}`,
    labelled && !dense ? 'pw-field--labeled' : 'pw-field--bare',
    dense ? 'pw-field--dense' : '', floated ? 'is-floated' : '', error ? 'has-error' : '',
    disabled ? 'is-disabled' : '', trailing ? 'has-trailing' : '', aiFilled ? 'is-ai-filled' : '', className,
  ].filter(Boolean).join(' ');

  if (kind === 'static') {
    return (
      <div className={classes}>
        {labelled ? <label htmlFor={id} className="pw-field__label">{labelText(label, required)}</label> : null}
        {children}
        {aiFilled ? <AiFilledTag className="pw-field__ai" /> : null}
        <Assist hint={hint} error={error} hintId={hintId} errorId={errorId} />
      </div>
    );
  }
  return (
    <div className={classes}>
      <div className="pw-field__area">
        {children}
        {labelled ? <label htmlFor={id} className="pw-field__label">{labelText(label, required)}</label> : null}
        {trailing ? <span className="pw-field__trailing" aria-hidden="true">{trailing}</span> : null}
        {aiFilled ? <AiFilledTag className="pw-field__ai" /> : null}
      </div>
      {dense && !hint && !error ? null : <Assist hint={hint} error={error} hintId={hintId} errorId={errorId} />}
    </div>
  );
}
