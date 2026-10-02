import { getLanguage } from '../i18n/language.js';

// The options of TimeInput: "HH:MM" every `step` minutes from `min` to `max`.
// The label follows the language: "09.00" in Indonesian, "09:00" in English.
export function timeSlots({ min = '00:00', max = '23:45', step = 15 } = {}) {
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const out = [];
  for (let t = toMinutes(min); t <= toMinutes(max); t += step) {
    const value = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    out.push({ value, label: getLanguage() === 'en' ? value : value.replace(':', '.') });
  }
  return out;
}
