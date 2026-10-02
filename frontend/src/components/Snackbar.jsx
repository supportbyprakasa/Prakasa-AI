import Button from './Button';
import Icon from './Icon';
import IconButton from './IconButton';
import './snackbar.css';

// One snackbar (docs/ui-guideline.md §4.13): dark surface, white Roboto 14/20,
// an optional text action and a close button. Shown by ToastHost through
// toast(); render it directly only in the design gallery. ToastHost passes
// live={false}: it announces through its own persistent live regions, since a
// live region that mounts together with its text is often not read.
export default function Snackbar({ message, tone = 'info', role = 'status', live = true, action, onClose, closing = false, onAnimationEnd, onPointerEnter, onPointerLeave, onFocus, onBlur }) {
  return (
    <div
      className="pw-snackbar"
      role={live ? role : undefined}
      aria-live={live ? (role === 'alert' ? 'assertive' : 'polite') : undefined}
      aria-atomic={live ? 'true' : undefined}
      data-tone={tone}
      data-state={closing ? 'closing' : 'open'}
      onAnimationEnd={onAnimationEnd}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="pw-snackbar__text">{message}</div>
      {action || onClose ? (
        <div className="pw-snackbar__actions">
          {action ? (
            <Button
              variant="text"
              className="pw-snackbar__action"
              onClick={() => {
                action.onClick?.();
                onClose?.();
              }}
            >
              {action.label}
            </Button>
          ) : null}
          {onClose ? (
            <IconButton size="sm" label="Tutup" className="pw-snackbar__close" onClick={onClose}>
              <Icon name="close" size="md" />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
