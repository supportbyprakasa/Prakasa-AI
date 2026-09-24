export function shouldCloseDialogOnKey({ key, loading }) {
  return key === 'Escape' && !loading;
}
