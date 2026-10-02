import Avatar from '../../components/Avatar';

// The Google pages' avatar (Chat, Gmail, Groups) is the shared Avatar with a
// colour from the name. kind: person (initials) | space (initials on a rounded
// tile) | group | bot | deleted (icons). size: sm 32 | md 40 (the shared md |
// lg). The g-avatar class stays for page layout rules (chat.css).
const KIND_ICONS = { group: 'group', bot: 'smart_toy', deleted: 'person_off' };

export default function GoogleAvatar({ name = '', kind = 'person', size = 'md', src, className = '' }) {
  return (
    <Avatar
      name={name}
      src={src}
      size={size === 'sm' ? 'md' : 'lg'}
      tone="auto"
      icon={KIND_ICONS[kind]}
      shape={kind === 'space' ? 'tile' : 'circle'}
      muted={kind === 'deleted'}
      className={['g-avatar', className].filter(Boolean).join(' ')}
    />
  );
}
