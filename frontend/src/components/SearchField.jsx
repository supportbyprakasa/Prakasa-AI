import { forwardRef, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import IconButton from './IconButton';
import { mergeRefs } from './choiceParts';
import './search-field.css';

// Search pill (docs/ui-guideline.md §4.4): 46px, --pw-surface-container, radius
// 28, search icon 24; on focus it turns white and lifts (sementara). Used in the
// top bar and in DataGrid. Works controlled (`value` + `onChange(event)`) or
// uncontrolled. Enter calls onSearch(value); the clear button and Escape empty
// the field through a real input event, so onChange sees it too.
// variant="panel": the search inside a generation-A panel (DataGrid toolbar):
// same pill, but the text is Roboto 14 --pw-text like the rest of the table
// (the top bar keeps Google Sans 16 --pw-text-secondary, referensi §1).
function setNativeValue(input, next) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const SearchField = forwardRef(function SearchField({
  label, placeholder = 'Cari', value, defaultValue, onChange, onSearch, onClear, onKeyDown,
  variant = 'topbar', className = '', inputClassName = '', disabled, ...props
}, ref) {
  const input = useRef(null);
  const controlled = value !== undefined;
  const [filled, setFilled] = useState(() => Boolean(controlled ? String(value ?? '') : defaultValue));
  useEffect(() => { if (controlled) setFilled(String(value ?? '') !== ''); }, [controlled, value]);

  const clear = () => {
    if (!input.current) return;
    setNativeValue(input.current, '');
    setFilled(false);
    onClear?.();
    input.current.focus();
  };

  return (
    <div
      className={[
        'pw-search', variant === 'panel' ? 'pw-search--panel' : '', filled ? 'is-filled' : '', disabled ? 'is-disabled' : '', className,
      ].filter(Boolean).join(' ')}
      role="search"
    >
      <span className="pw-search__icon"><Icon name="search" /></span>
      <input
        ref={mergeRefs(input, ref)}
        type="search"
        aria-label={label || placeholder}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        {...props}
        className={['pw-search__input', inputClassName].filter(Boolean).join(' ')}
        onChange={(event) => { setFilled(event.target.value !== ''); onChange?.(event); }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'Enter') onSearch?.(event.currentTarget.value);
          if (event.key === 'Escape' && event.currentTarget.value) { event.preventDefault(); clear(); }
        }}
      />
      {filled && !disabled ? <IconButton size="sm" icon="close" label="Hapus pencarian" className="pw-search__clear" onClick={clear} /> : null}
    </div>
  );
});

export default SearchField;
