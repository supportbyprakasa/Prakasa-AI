export function engineMenuItems(providers = []) {
  return providers.map((item) => ({
    value: item.id,
    label: item.label,
    description: item.available
      ? (item.model ? `Model ${item.model}` : 'Tersedia')
      : 'Belum tersedia untuk akun Anda',
    disabled: !item.available,
  }));
}

export function engineChipLabel(providers = [], providerId, fallbackModel) {
  const item = providers.find((provider) => provider.id === providerId);
  if (!item) return providerId || 'Engine default';
  const model = item.model || fallbackModel;
  return model ? `${item.label} · ${model}` : item.label;
}

export function visibilityMenuItems(user) {
  return [
    { value: 'private', label: 'Pribadi', description: 'Hanya Anda yang dapat membaca' },
    ...(user?.departmentId || (user?.permissions || []).includes('ai_command.admin.view')
      ? [{ value: 'department', label: 'Divisi', description: 'Semua anggota divisi bisa membaca dan ikut bertanya' }]
      : []),
    { value: 'entity', label: 'Lintas divisi', description: 'Dibagikan sesuai akses entity' },
  ];
}

export const VISIBILITY_LABELS = {
  private: 'Pribadi',
  department: 'Divisi',
  entity: 'Lintas divisi',
};
