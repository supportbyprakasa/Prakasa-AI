import Icon from '../../components/Icon';
import { useRealtimeStatus } from '../../api/realtime';
import { initials, typeLabel } from './trackerModel';

const TYPE_SYMBOLS = { task: 'check_box', bug: 'bug_report', story: 'bookmark', epic: 'bolt', subtask: 'subdirectory_arrow_right' };

// Issue type glyph; colour is decorative (the type name is always the accessible label).
export function IssueTypeIcon({ type, withLabel = false }) {
  const known = TYPE_SYMBOLS[type] ? type : 'task';
  return (
    <span className={`tracker-type tracker-type--${known}`}>
      <Icon name={TYPE_SYMBOLS[known]} size="sm" className="tracker-type__icon" />
      {withLabel ? <span>{typeLabel(type)}</span> : <span className="pw-visually-hidden">{typeLabel(type)}</span>}
    </span>
  );
}

export function Avatar({ person, size = 'md' }) {
  if (!person) {
    return <span className={`tracker-avatar tracker-avatar--empty tracker-avatar--${size}`} role="img" aria-label="Belum ditugaskan">?</span>;
  }
  const name = person.name || person.email || '';
  return <span className={`tracker-avatar tracker-avatar--${size}`} role="img" aria-label={name} data-no-translate="">{initials(name)}</span>;
}

const LIVE_TEXT = {
  live: 'Live',
  connecting: 'Menyambung…',
  reconnecting: 'Menyambung ulang…',
  paused: 'Dijeda',
  stopped: 'Offline',
  idle: 'Offline',
};

// Realtime state: a dot + one word; the explanation is read to screen readers.
export function LiveIndicator() {
  const status = useRealtimeStatus();
  const text = LIVE_TEXT[status] || 'Offline';
  const hint = status === 'live'
    ? 'Perubahan dari anggota lain tampil otomatis.'
    : 'Pembaruan otomatis sedang tidak aktif; data dimuat ulang saat tersambung.';
  return (
    <span className={`tracker-live tracker-live--${status}`} role="status">
      <span className="tracker-live__dot" aria-hidden="true" />
      <span>{text}</span>
      <span className="pw-visually-hidden">{hint}</span>
    </span>
  );
}
