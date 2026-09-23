import { useEffect, useRef } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';

const MAX_TEXTAREA_HEIGHT = 240;

export default function AIComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  sendDisabled = false,
  busy = false,
  placeholder,
  tools,
  trailing,
  autoFocus = false,
}) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus && !disabled) textareaRef.current?.focus();
  }, [autoFocus, disabled]);

  const onKeyDown = (event) => {
    // isComposing: do not submit while an IME candidate window is open.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendDisabled) onSubmit();
    }
  };

  return (
    <div className={`ai-composer${disabled ? ' is-disabled' : ''}`}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="ai-composer-row">
        <div className="ai-composer-tools">{tools}</div>
        <div className="ai-composer-trailing">
          {trailing}
          <button
            type="button"
            className="ai-send-button ai-ripple"
            onClick={onSubmit}
            disabled={sendDisabled}
            aria-label="Kirim pesan"
            title="Kirim (Enter) · baris baru (Shift+Enter)"
          >
            {busy ? <Loader2 className="ai-spin" size={18} /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
