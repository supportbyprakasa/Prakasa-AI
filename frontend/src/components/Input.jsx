import { useId } from 'react';

export default function Input({ label, error, className = '', ...props }) {
  const generatedId = useId();
  const id = props.id || props.name || generatedId;
  const errorId = `${id}-error`;
  return (
    <div className="pw-field">
      {label && <label htmlFor={id} className="pw-field__label">{label}</label>}
      <input
        {...props}
        id={id}
        className={['pw-field__input', className].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : props['aria-describedby']}
      />
      {error && <span id={errorId} className="pw-field__error">{error}</span>}
    </div>
  );
}
