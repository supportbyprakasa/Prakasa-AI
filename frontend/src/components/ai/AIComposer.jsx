import { useEffect, useRef } from 'react';
import IconButton from '../IconButton';
import Spinner from '../Spinner';
import { filesFromClipboard } from './aiFiles';

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
  header,
  onStop,
  canStop = false,
  stopping = false,
  onFiles,
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

  const onPaste = (event) => {
    if (!onFiles) return;
    // Text copied from Word or Excel can also carry an image rendering; then the text paste is kept.
    const files = filesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    onFiles(files);
  };

  const onKeyDown = (event) => {
    // isComposing: do not submit while an IME candidate window is open.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendDisabled) onSubmit();
    }
  };

  return (
    <div className={`ai-composer${disabled ? ' is-disabled' : ''}`}>
      {header}
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="ai-composer-row">
        <div className="ai-composer-tools">{tools}</div>
        <div className="ai-composer-trailing">
          {trailing}
          {canStop ? (
            <IconButton
              variant="filled"
              size="sm"
              label="Hentikan jawaban"
              icon={stopping ? <Spinner label={null} /> : 'stop'}
              onClick={onStop}
              disabled={stopping}
            />
          ) : (
            <IconButton
              variant="filled"
              size="sm"
              label="Kirim (Enter) · baris baru (Shift+Enter)"
              aria-label="Kirim pesan"
              icon={busy ? <Spinner label={null} /> : 'arrow_upward'}
              onClick={onSubmit}
              disabled={sendDisabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}
