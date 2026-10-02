import { dateLocale } from '../../i18n/language.js';
// The Claude Team seat behind Prakasa AI, as the Super Admin should read it:
// how full the current usage window is, when it resets, and whether answers
// are paused. Mirrors backend/src/services/ai/claudeTeamLimits.js.

const WINDOW_LABEL = { five_hour: 'Batas 5 jam', seven_day: 'Batas mingguan', seven_day_opus: 'Batas mingguan Opus' };

export function formatWib(iso) {
  if (!iso) return null;
  return `${new Intl.DateTimeFormat(dateLocale(), {
    timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))} WIB`;
}

export function seatHealth(health) {
  if (!health) return null;
  const pct = health.utilization == null ? null : Math.round(Number(health.utilization) * 100);
  let tone = 'success';
  let headline = 'Normal';
  if (health.reachable === false) { tone = 'error'; headline = 'Runner tidak terjangkau — Prakasa AI tidak bisa menjawab'; }
  else if (health.loggedIn === false) { tone = 'error'; headline = 'Belum login — Prakasa AI tidak bisa menjawab'; }
  else if (health.cooldownUntil) { tone = 'error'; headline = `Kuota habis — dijeda sampai ${formatWib(health.cooldownUntil)}`; }
  else if (pct != null && pct >= 80) { tone = 'warning'; headline = `Kuota hampir habis (${pct}%)`; }
  return {
    tone,
    headline,
    pct,
    // A window this page does not know yet is still named in words, never by its code.
    windowLabel: WINDOW_LABEL[health.rateType] || (health.rateType ? 'Batas pemakaian' : 'Belum ada data'),
    resetsAt: formatWib(health.resetsAt),
    queue: health.queue
      ? `${health.queue.running} berjalan · ${health.queue.waiting} menunggu (maks ${health.queue.concurrent} bersamaan)`
      : null,
  };
}
