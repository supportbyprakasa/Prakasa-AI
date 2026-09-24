export const MOBILE_BREAKPOINT = 700;
export const DESKTOP_BREAKPOINT = 1180;
export const DEFAULT_DOCUMENT_PANEL_WIDTH = 400;
export const MIN_DOCUMENT_PANEL_WIDTH = 320;
export const MAX_DOCUMENT_PANEL_WIDTH = 576;

export function resolveResponsiveMode(viewportWidth) {
  const width = Number(viewportWidth);
  if (width < MOBILE_BREAKPOINT) return 'mobile';
  if (width < DESKTOP_BREAKPOINT) return 'tablet';
  return 'desktop';
}

export function clampDocumentPanelWidth(panelWidth, viewportWidth) {
  const viewport = Number(viewportWidth);
  const maximumForViewport = Number.isFinite(viewport)
    ? Math.min(MAX_DOCUMENT_PANEL_WIDTH, Math.max(MIN_DOCUMENT_PANEL_WIDTH, viewport - 816))
    : MAX_DOCUMENT_PANEL_WIDTH;
  const requestedWidth = Number(panelWidth);
  const safeWidth = Number.isFinite(requestedWidth)
    ? requestedWidth
    : DEFAULT_DOCUMENT_PANEL_WIDTH;

  return Math.min(maximumForViewport, Math.max(MIN_DOCUMENT_PANEL_WIDTH, safeWidth));
}

export function normalizeStoredPanelWidth(storedValue, viewportWidth) {
  if (storedValue === null || storedValue === undefined || storedValue === '') {
    return clampDocumentPanelWidth(DEFAULT_DOCUMENT_PANEL_WIDTH, viewportWidth);
  }

  const parsed = Number(storedValue);
  return clampDocumentPanelWidth(
    Number.isFinite(parsed) ? parsed : DEFAULT_DOCUMENT_PANEL_WIDTH,
    viewportWidth,
  );
}

export const RECENCY_GROUPS = [
  { key: 'today', label: 'Hari ini' },
  { key: 'yesterday', label: 'Kemarin' },
  { key: 'week', label: '7 hari terakhir' },
  { key: 'month', label: '30 hari terakhir' },
  { key: 'older', label: 'Lebih lama' },
];

function startOfLocalDay(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function recencyKey(isoDate, now = new Date()) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'older';
  // Rounding absorbs the ±1h difference on daylight-saving transitions.
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  if (days < 30) return 'month';
  return 'older';
}

export function groupSessionsByRecency(sessions, now = new Date()) {
  const buckets = new Map(RECENCY_GROUPS.map((group) => [group.key, []]));
  const pinned = [];
  for (const session of sessions || []) {
    if (session.pinned) pinned.push(session);
    else buckets.get(recencyKey(session.lastMessageAt || session.createdAt, now)).push(session);
  }
  return [
    { key: 'pinned', label: 'Disematkan', items: pinned },
    ...RECENCY_GROUPS.map((group) => ({ ...group, items: buckets.get(group.key) })),
  ].filter((group) => group.items.length > 0);
}

// A message can be edited by its author once saved, while the chat accepts messages.
export function canEditMessage({ message, userId, canSend, generating, archived }) {
  return Boolean(
    message?.role === 'user'
    && Number.isFinite(Number(message.id))
    && Number(message.createdBy) === Number(userId)
    && canSend && !generating && !archived,
  );
}

// Editing discards the edited message and everything after it, then shows the new draft.
export function messagesAfterEdit(messages, messageId, draft) {
  const index = messages.findIndex((item) => Number(item.id) === Number(messageId));
  const kept = index === -1 ? messages : messages.slice(0, index);
  return [...kept, draft];
}

export function greetingForHour(hour) {
  const value = Number(hour);
  if (value >= 4 && value < 11) return 'Selamat pagi';
  if (value >= 11 && value < 15) return 'Selamat siang';
  if (value >= 15 && value < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function titleFromMessage(text, maxLength = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Percakapan baru';
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export function firstNameOf(user) {
  const name = String(user?.name || '').trim();
  if (name) return name.split(/\s+/)[0];
  const email = String(user?.email || '');
  return email ? email.split('@')[0] : '';
}

// For a reply that is still streaming: close markers left open so the draft renders as
// formatted text instead of showing raw `**` or an unterminated code block.
export function closeOpenMarkdown(text) {
  const value = String(text || '');
  if ((value.match(/```/g) || []).length % 2 === 1) return `${value}\n\`\`\``;

  const outsideFences = value.replace(/```[\s\S]*?```/g, '');
  const outsideCode = outsideFences.replace(/`[^`\n]*`/g, '');
  let result = value;
  if ((outsideCode.match(/`/g) || []).length % 2 === 1) return `${result}\``;
  if ((outsideCode.match(/\*\*/g) || []).length % 2 === 1) {
    // A closing ** directly after whitespace is not treated as bold by Markdown.
    result = `${result.replace(/\s+$/, '')}**`;
  }
  return result;
}

// Parses a Server-Sent Events buffer; `rest` holds an incomplete trailing event.
export function parseSseEvents(buffer) {
  const normalized = String(buffer || '').replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop();
  const events = [];

  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }

  return { events, rest };
}

export function isGenerationActive({ sending = false, generationStatus } = {}) {
  return Boolean(sending || generationStatus === 'generating');
}

export function getGooglePreviewUrl(webViewLink) {
  try {
    const url = new URL(webViewLink);
    const isGoogleDocument = [
      'docs.google.com',
      'drive.google.com',
    ].includes(url.hostname);
    if (!isGoogleDocument || !url.pathname.includes('/d/')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    const documentIdIndex = parts.indexOf('d') + 1;
    if (!documentIdIndex || !parts[documentIdIndex]) return null;

    const prefix = parts.slice(0, documentIdIndex + 1).join('/');
    return `${url.origin}/${prefix}/preview`;
  } catch {
    return null;
  }
}
