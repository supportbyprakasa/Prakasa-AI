import Chip from '../Chip';

export default function AIWebToggle({ active, onToggle, disabled = false }) {
  return (
    <Chip
      className="ai-chip-button"
      icon="public"
      selected={Boolean(active)}
      tooltip={disabled ? undefined : (active ? 'Riset web aktif' : 'Aktifkan riset web')}
      onClick={onToggle}
      disabled={disabled}
      aria-label={active
        ? 'Riset web aktif: AI boleh mencari informasi di internet dan menyertakan sumber'
        : 'Aktifkan riset web: AI boleh mencari informasi di internet'}
    >
      Riset web
    </Chip>
  );
}

export function toolStatusLabel(status) {
  if (!status) return '';
  if (status.tool === 'WebSearch') return status.target ? `Mencari di web: “${status.target}”` : 'Mencari di web…';
  if (status.tool === 'WebFetch') return status.target ? `Membuka halaman ${status.target}` : 'Membuka halaman web…';
  return 'Menjalankan alat…';
}
