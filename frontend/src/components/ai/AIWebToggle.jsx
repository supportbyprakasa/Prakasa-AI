import { Globe } from 'lucide-react';

export default function AIWebToggle({ active, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      className={`ai-chip-button ai-ripple${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onToggle}
      disabled={disabled}
      title={active
        ? 'Riset web aktif: AI boleh mencari informasi di internet dan menyertakan sumber'
        : 'Aktifkan riset web: AI boleh mencari informasi di internet'}
    >
      <Globe size={15} />
      <span className="ai-chip-label">Riset web</span>
    </button>
  );
}

export function toolStatusLabel(status) {
  if (!status) return '';
  if (status.tool === 'WebSearch') return status.target ? `Mencari di web: “${status.target}”` : 'Mencari di web…';
  if (status.tool === 'WebFetch') return status.target ? `Membuka halaman ${status.target}` : 'Membuka halaman web…';
  return 'Menjalankan alat…';
}
