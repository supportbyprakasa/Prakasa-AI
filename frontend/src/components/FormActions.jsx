import './form-actions.css';

// Bottom-of-form button row (docs/ui-guideline.md §3.3): Batal (text) first,
// the one primary action last, both bottom-right. `align` start | end |
// between. `sticky` pins the row to the bottom of the viewport for long forms;
// the floating AI button then lifts above it so it never covers the action.
export default function FormActions({ children, align = 'end', sticky = false, className = '' }) {
  return (
    <div className={['pw-form-actions', `pw-form-actions--${align}`, sticky ? 'pw-form-actions--sticky' : '', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
