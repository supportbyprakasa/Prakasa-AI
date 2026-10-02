import Card from '../../../components/Card';
import Icon from '../../../components/Icon';
import IconButton from '../../../components/IconButton';
import './drive.css';

// One file or folder in a Drive browser (Penyimpanan divisi, My Drive). The
// admin console has no file browser, so this follows Google Drive's grid item
// with the admin console tokens: a tinted card (radius 12) with the thumbnail
// or type icon, the name and a meta line. The whole card opens the item (state
// layer + ripple); the delete action sits at the end of the card.
// `name` is the file's own name (record data, never translated); `meta` is a
// node the caller builds (<Mixed> when it joins an owner name and a date).
export default function FileCard({ name, meta, icon = 'draft', thumbnail, onOpen, onDelete, deleteLabel }) {
  return (
    <div className="drive-card">
      <Card as="button" type="button" noPadding className="drive-card__open pw-state-layer" onClick={onOpen}>
        {thumbnail
          ? <img src={thumbnail} alt="" className="drive-card__thumb" />
          : <span className="drive-card__icon"><Icon name={icon} /></span>}
        <span className="drive-card__text">
          <span className="drive-card__name" data-no-translate="">{name}</span>
          {meta ? <span className="drive-card__meta">{meta}</span> : null}
        </span>
      </Card>
      {onDelete ? (
        <span className="drive-card__action">
          <IconButton label={deleteLabel || `Hapus ${name}`} icon="delete" size="sm" onClick={onDelete} />
        </span>
      ) : null}
    </div>
  );
}
