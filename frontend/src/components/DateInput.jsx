import { forwardRef } from 'react';
import Input from './Input';

// Date field (docs/ui-guideline.md §4.3): the underlined Input with the
// browser's date picker behind a calendar icon; the label is always floated
// because the browser always shows a date mask. type: date | datetime-local |
// month | time. The value stays the browser format (YYYY-MM-DD); show dates to
// people through format.js.
const DateInput = forwardRef(function DateInput({ type = 'date', ...props }, ref) {
  return <Input ref={ref} type={type} {...props} />;
});

export default DateInput;
