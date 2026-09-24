const EXECUTABLE_ACTION_TYPES = new Set(['create_task']);

export function confirmationSuccessMessage(result) {
  return result?.executionDeferred
    ? 'Aksi dikonfirmasi, tetapi belum dapat dijalankan otomatis'
    : 'Aksi dikonfirmasi dan dijalankan';
}

export function confirmationDialogCopy(item) {
  if (!item) return '';
  const action = `${item.actionLabel}: “${item.title}”.`;
  if (EXECUTABLE_ACTION_TYPES.has(item.actionType)) {
    return `${action} Setelah dikonfirmasi, aksi akan langsung dijalankan atas nama Anda.`;
  }
  return `${action} Proposal akan dikonfirmasi, tetapi belum dijalankan otomatis karena executor aksi ini belum tersedia.`;
}

export function shouldShowInboxEmpty({ loading, error, data }) {
  if (loading || error || !data) return false;
  return !data.proposals?.length && !data.approvals?.length && !data.notifications?.length;
}
