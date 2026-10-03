// Pure helpers shared by the Gantt components (no React).
import { formatDate } from '../format.js';
import { statusLabel, statusTone } from '../statusTone.js';

// A bar's colour is its status TONE from components/statusTone.js (open and
// closed neutral, in_progress info, review warning, done success, cancelled
// error), so the chart never disagrees with the status text next to it. The
// tone classes live in gantt.css.
export const toneClass = (status) => `gantt-tone--${statusTone(status)}`;

// "1 Sep 2026 – 30 Sep 2026"
export const dateRangeText = (task) => `${formatDate(task?.startDate)} – ${formatDate(task?.dueDate)}`;

export const isEstimated = (task) => Boolean(task?.isFallbackStart || task?.isFallbackDue);

// What a bar says to a screen reader and in its tooltip.
export function barText(task) {
  return [
    task.title,
    dateRangeText(task),
    statusLabel(task.status),
    isEstimated(task) ? 'tanggal estimasi' : null,
    task.isCancelled ? 'dibatalkan' : null,
  ].filter(Boolean).join(' · ');
}

// Axis label: "1 Sep"; the year only on the first tick and where it changes.
export function tickLabel(iso, previous) {
  const full = formatDate(iso);
  if (!previous || String(previous).slice(0, 4) !== String(iso).slice(0, 4)) return full;
  return full.split(' ').slice(0, 2).join(' ');
}

// Props that make a non-button element a real control: role, focus, and
// Enter / Space acting like a click. Nothing when there is nothing to do.
export function pressProps(onPress, label) {
  if (!onPress) return {};
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: (event) => { event.stopPropagation(); onPress(); },
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onPress();
    },
  };
}
