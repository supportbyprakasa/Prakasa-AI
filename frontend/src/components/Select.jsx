import { forwardRef } from 'react';
import Icon from './Icon';
import { FieldShell, describedBy, useFieldIds } from './fieldParts';
import { withSuffix } from '../i18n/tr.js';

// Underlined select with a floating label and arrow_drop_down (§4.3).
// options: [{ value, label }] — or pass <option> children directly.
// placeholder renders an empty first option ("Pilih …" / "Semua"). The label
// floats whenever the select shows text, and rests only on an option without
// text (placeholder="") or an empty list.
// Language switch: option labels are interface text and are translated.
// `dataOptions` says the options come from records (customer, item,
// salesperson, warehouse, user names …) and are never translated; one option
// can still opt in with `translate: true` ("Semua gudang"), or opt out alone
// with `data: true`. The placeholder is always interface text (also inside a
// record-data zone such as a grid cell). With <option>
// children, spread `noTranslate` (i18n/NoTranslate.jsx) on a record's option.
// An option that is a record's name plus an interface note takes the note as
// `suffix`: { label: location.name, suffix: '(nonaktif)' }. An <option> holds
// one string, so the suffix is translated here (i18n/tr.js) and the name is
// left exactly as stored — the option itself is a record-data zone.
const optionZone = (option, dataOptions) => {
  const data = option.data ?? (option.suffix ? true : (dataOptions && !option.translate));
  return data ? { 'data-no-translate': '' } : null;
};
export const optionText = (option) => (option.suffix ? withSuffix(option.label, option.suffix) : option.label);

const Select = forwardRef(function Select({ label, error, hint, options, dataOptions = false, placeholder, className = '', fieldClassName = '', dense = false, mono = false, aiFilled = false, children, ...props }, ref) {
  const { id, hintId, errorId } = useFieldIds(props);
  return (
    <FieldShell
      id={id} label={label} required={props.required} hint={hint} error={error} hintId={hintId} errorId={errorId}
      className={fieldClassName} kind="select" dense={dense} disabled={props.disabled} aiFilled={aiFilled}
      trailing={<Icon name="arrow_drop_down" />}
    >
      <select
        ref={ref}
        {...props}
        id={id}
        className={['pw-field__input', mono ? 'pw-field__input--mono' : '', className].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy({ hint, error, hintId, errorId, extra: props['aria-describedby'] })}
      >
        {placeholder !== undefined ? <option value="" data-translate="">{placeholder}</option> : null}
        {options ? options.map((option) => (
          <option key={String(option.value)} value={option.value} disabled={option.disabled} {...optionZone(option, dataOptions)}>{optionText(option)}</option>
        )) : children}
      </select>
    </FieldShell>
  );
});

export default Select;
