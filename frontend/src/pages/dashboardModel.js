// Pure helpers for the home page's work summary.
import { formatDate } from '../components/format.js';

export function greetingFor(hour) {
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}

// Shortcuts shown above the summary, in this order, when the role can open them.
export const QUICK_LINKS = [
  '/mail', '/chat', '/calendar', '/docs', '/my-drive', '/ai-command', '/it/tickets',
];

// Material Symbols per summary card; anything unknown falls back to the bell.
const CARD_SYMBOLS = {
  it_waiting: 'support', it_mine: 'support', it_queue: 'support',
  signatures: 'draw',
  warehouse_approval: 'warehouse', warehouse_mine: 'warehouse',
  finance_approval: 'account_balance', finance_revise: 'account_balance', finance_mine: 'account_balance', finance_queue: 'account_balance',
  hrga_tasks: 'person_add', hrga_approval: 'person_add',
  ga_assigned: 'room_service', ga_approval: 'room_service', ga_mine: 'room_service',
};

export function cardSymbol(key) {
  return CARD_SYMBOLS[key] || 'notifications';
}

const GROUPS = ['action', 'mine', 'team'];

export function groupCards(cards) {
  const grouped = Object.fromEntries(GROUPS.map((group) => [group, []]));
  (Array.isArray(cards) ? cards : []).forEach((card) => { if (grouped[card?.group]) grouped[card.group].push(card); });
  return grouped;
}

// The /work-summary answer in one known shape, so an unexpected answer shows an
// empty summary instead of breaking the page.
export function normalizeSummary(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const cards = (Array.isArray(source.cards) ? source.cards : [])
    .filter((card) => card && typeof card === 'object')
    .map((card) => ({ ...card, items: Array.isArray(card.items) ? card.items : [], count: Number(card.count) || 0 }));
  const notifications = source.notifications && typeof source.notifications === 'object' ? source.notifications : {};
  return {
    cards,
    notifications: {
      unread: Number(notifications.unread) || 0,
      recent: Array.isArray(notifications.recent) ? notifications.recent : [],
    },
  };
}

// "5 menit lalu", "kemarin", "3 hari lagi" — dates in the future read as deadlines.
export function formatRelative(iso, now = new Date()) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.round((now.getTime() - then.getTime()) / 60000);
  if (minutes < 0) {
    const days = Math.ceil(-minutes / 1440);
    return days <= 1 ? 'besok' : `${days} hari lagi`;
  }
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'kemarin';
  if (days < 30) return `${days} hari lalu`;
  return formatDate(then);
}
