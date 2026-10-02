// The steps behind an agent answer ("Membaca notifikasi Anda", "Mencari di web"),
// as streamed by the server: a start event per tool call, then its result.

export function upsertStep(steps, event) {
  if (!event || event.type !== 'step' || !event.id && event.id !== '') return steps;
  const index = steps.findIndex((s) => s.id === event.id && event.id !== '');
  if (index >= 0) {
    const next = [...steps];
    next[index] = { ...next[index], status: event.status || next[index].status };
    return next;
  }
  return [...steps, {
    id: event.id || `step-${steps.length + 1}`,
    tool: event.tool || '',
    label: event.label || event.tool || 'Langkah',
    target: event.target || null,
    status: event.status || 'running',
  }];
}

export const runningStep = (steps) => [...(steps || [])].reverse().find((s) => s.status === 'running') || null;

export function stepText(step) {
  if (!step) return '';
  return step.target ? `${step.label}: “${step.target}”` : step.label;
}

// One line for the collapsed timeline.
export function stepsSummary(steps, { live = false } = {}) {
  const list = steps || [];
  if (!list.length) return '';
  const current = live ? runningStep(list) : null;
  if (current) return `${stepText(current)}…`;
  const failed = list.filter((s) => s.status === 'error').length;
  const base = list.length === 1 ? stepText(list[0]) : `${list.length} langkah`;
  return failed ? `${base} · ${failed} gagal` : base;
}
