// "Butuh bantuan IT" from the top bar (owner, 1 Oct 2026): pure helpers, tested.
export const HELP_CATEGORIES = [
  { value: 'device_damage', label: 'Perangkat rusak atau bermasalah' },
  { value: 'access_software', label: 'Akses, akun, atau software' },
  { value: 'network', label: 'Internet atau jaringan' },
  { value: 'new_device_request', label: 'Minta perangkat baru' },
];

export const HELP_PRIORITIES = [
  { value: 'low', label: 'Rendah' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Tinggi' },
  { value: 'urgent', label: 'Mendesak' },
];

export const EMPTY_HELP = { category: '', title: '', description: '', priority: 'normal', deviceId: '' };

export function validateHelp(values) {
  const errors = {};
  if (!values.category) errors.category = 'Pilih jenis masalah.';
  if (!String(values.title || '').trim()) errors.title = 'Tulis judul singkat.';
  else if (values.title.trim().length > 190) errors.title = 'Judul paling banyak 190 karakter.';
  if (!String(values.description || '').trim()) errors.description = 'Ceritakan masalahnya.';
  else if (values.description.trim().length > 4000) errors.description = 'Paling banyak 4.000 karakter.';
  return errors;
}

// The request body: the page it was sent from goes along so IT sees the context.
export function helpPayload(values, pathname) {
  return {
    category: values.category,
    title: values.title.trim(),
    description: values.description.trim(),
    priority: values.priority || 'normal',
    deviceId: values.deviceId ? Number(values.deviceId) : null,
    sourcePage: typeof pathname === 'string' && pathname.startsWith('/') ? pathname.slice(0, 200) : null,
  };
}

export function helpSentMessage(result) {
  const id = result?.id;
  return result?.emailed
    ? `Tiket IT #${id} terkirim. Tim IT sudah menerima email di ${result.supportEmail}.`
    : `Tiket IT #${id} terkirim. Tim IT akan menindaklanjutinya.`;
}
