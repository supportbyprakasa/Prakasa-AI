export function shouldCloseDialogOnKey({ key, loading }) {
  return key === 'Escape' && !loading;
}

// Which button a confirmation focuses when it opens: the safe one (Batal) for
// a destructive action, so a stray Enter never deletes; the action otherwise.
export function confirmInitialFocus(tone) {
  return tone === 'danger' ? 'cancel' : 'confirm';
}
