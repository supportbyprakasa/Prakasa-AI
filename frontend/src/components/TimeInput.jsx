import { forwardRef } from 'react';
import Select from './Select';
import { timeSlots } from './timeSlots';

// Time of day on a fixed step (docs/ui-guideline.md §4.3; added for Layanan GA,
// rancangan-people-culture-g2.md §3.5): the underlined Select with a floating
// label, listing "HH:MM" every `step` minutes (default 15) between `min` and
// `max`. A list instead of the browser's time picker, so only valid times can
// be chosen and it reads the same on every phone. The value is "HH:MM" (the
// caller pairs it with a date); option labels use the Indonesian dot ("09.15").
const TimeInput = forwardRef(function TimeInput({ min, max, step = 15, placeholder, ...props }, ref) {
  return <Select ref={ref} options={timeSlots({ min, max, step })} placeholder={placeholder} {...props} />;
});

export default TimeInput;
