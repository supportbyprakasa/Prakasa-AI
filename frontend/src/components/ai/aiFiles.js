export const AI_FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.png,.jpg,.jpeg,.webp,.txt,.csv,.md,.markdown,.json,.xml,.html,.htm,.rtf';
export const AI_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const AI_MAX_PENDING_FILES = 5;

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
