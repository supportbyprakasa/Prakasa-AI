// Indonesian labels for the codes the AI pages receive from the API (usage
// events, AI modules, providers, the server's Claude Code login). Unknown
// codes fall back to their words, never to a blank cell.

const words = (code) => String(code || '').replace(/[._:-]+/g, ' ').replace(/\s+/g, ' ').trim();
const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

export const AI_PROVIDER_LABELS = {
  claude_team: 'Claude Team',
  claude: 'Claude API',
  gemini: 'Gemini API',
  openai: 'OpenAI API',
  n8n: 'n8n AI Gateway',
};

export const AI_MODULE_LABELS = {
  ai_command_center: 'Pusat perintah AI',
  claude_team: 'Claude Team',
  document_assistant: 'Asisten dokumen',
  document_check: 'Cek dokumen',
  signature_precheck: 'Cek awal tanda tangan',
  meeting_summary: 'Ringkasan rapat',
  daily_brief: 'Ringkasan harian',
  knowledge_base: 'Basis pengetahuan',
  it_asset_report: 'Laporan aset IT',
  field_sales_bot: 'Bot sales lapangan',
};

export const AI_EVENT_LABELS = {
  'chat.completion': 'Jawaban percakapan',
  session_created: 'Sesi dibuat',
  context_read: 'Konteks dibaca',
  message: 'Pesan',
  message_failed: 'Pesan gagal',
  message_stopped: 'Pesan dihentikan',
  agent_message: 'Pesan agen',
  action_proposed: 'Aksi diusulkan',
  action_confirmed: 'Aksi dikonfirmasi',
  action_executed: 'Aksi dijalankan',
  action_rejected: 'Aksi ditolak',
  document_generated: 'Dokumen dibuat',
  document_uploaded: 'Dokumen diunggah',
};

const SUBSCRIPTION_LABELS = { team: 'Team', pro: 'Pro', max: 'Max', enterprise: 'Enterprise', free: 'Gratis' };
const AUTH_METHOD_LABELS = { 'claude.ai': 'Akun claude.ai', api_key: 'Kunci API', apiKey: 'Kunci API', oauth: 'OAuth' };

const lookup = (map) => (code) => (code ? map[code] || sentence(words(code)) : '');

export const aiProviderLabel = lookup(AI_PROVIDER_LABELS);
export const aiModuleLabel = lookup(AI_MODULE_LABELS);
export const aiEventLabel = lookup(AI_EVENT_LABELS);
export const subscriptionLabel = lookup(SUBSCRIPTION_LABELS);
export const authMethodLabel = lookup(AUTH_METHOD_LABELS);

// "Pengguna #12" when the row carries only the id.
export function aiUserLabel(row) {
  if (!row) return '';
  if (row.userName) return row.userName;
  return row.userId != null && row.userId !== '' ? `Pengguna #${row.userId}` : '';
}

// Label with the code kept for search and export: "Pusat perintah AI (ai_command_center)".
export function labelWithCode(label, code) {
  if (!code) return '';
  return label && label !== code ? `${label} (${code})` : String(code);
}
