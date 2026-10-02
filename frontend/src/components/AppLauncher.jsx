import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import Icon from './Icon';
import IconButton from './IconButton';
import { anchoredProps, useAnchoredPosition, useOverlay, usePresence } from './useOverlay';
import { appUrl, availableApps, internalRoute, splitApps, toggleFavorite } from './appLauncherModel';
import './app-launcher.css';

const storageKey = (userId) => `prakasa-app-favorites:${userId || 'anon'}`;

function readFavorites(userId) {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function AppTile({ app, email, permissions, userName, avatarUrl, editing, isFavorite, onToggle, onOpen }) {
  const to = internalRoute(app, permissions);
  const icon = app.avatar
    ? <Avatar name={userName} src={avatarUrl} size="lg" />
    : <img className="pw-apps__icon" src={app.icon} alt="" />;
  const content = (
    <>
      <span className="pw-apps__glyph">
        {icon}
        {editing ? (
          <span className={`pw-apps__mark${isFavorite ? ' is-remove' : ''}`} aria-hidden="true">
            <Icon name={isFavorite ? 'remove' : 'add'} size="sm" />
          </span>
        ) : null}
      </span>
      <span className="pw-apps__label">
        {app.label}
        {!to && !editing ? <Icon name="north_east" size="sm" className="pw-apps__external" label="dibuka di tab baru" /> : null}
      </span>
    </>
  );
  if (editing) {
    return (
      <button
        type="button"
        className="pw-apps__tile pw-state-layer"
        aria-pressed={isFavorite}
        aria-label={`${isFavorite ? 'Hapus' : 'Tambahkan'} ${app.label} ${isFavorite ? 'dari' : 'ke'} favorit`}
        onClick={() => onToggle(app.id)}
      >
        {content}
      </button>
    );
  }
  if (to) {
    return <Link className="pw-apps__tile pw-state-layer" to={to} onClick={onOpen}>{content}</Link>;
  }
  return (
    <a className="pw-apps__tile pw-state-layer" href={appUrl(app, email)} target="_blank" rel="noreferrer" onClick={onOpen}>
      {content}
    </a>
  );
}

// Google-style app launcher for the Google Workspace apps the company uses: a
// 40px top-bar button opening a menu-style panel (docs/ui-guideline.md §2.1),
// portaled to <body> and placed like Menu: below the button, aligned to its end.
export default function AppLauncher({ user, open, onOpenChange }) {
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState(() => readFavorites(user?.id));

  useEffect(() => { setFavoriteIds(readFavorites(user?.id)); }, [user?.id]);
  useEffect(() => { if (!open) setEditing(false); }, [open]);

  // A non-modal overlay in the shared stack: Escape closes it when it is the
  // top-most one and focus returns to the button; a click outside closes it.
  const panelRef = useRef(null);
  const presence = usePresence(Boolean(open));
  useOverlay({ open: Boolean(open), containerRef: panelRef, onEscape: () => onOpenChange(false), onTabOut: () => onOpenChange(false), modal: false });
  const position = useAnchoredPosition({ open: Boolean(open), anchorRef: buttonRef, surfaceRef: panelRef, deps: [editing, favoriteIds] });
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, onOpenChange]);

  const apps = useMemo(() => availableApps(user?.permissions), [user?.permissions]);
  const { favorites, others } = useMemo(() => splitApps(apps, favoriteIds), [apps, favoriteIds]);

  const toggle = (id) => {
    const next = toggleFavorite(favorites.map((app) => app.id), id);
    setFavoriteIds(next);
    try { window.localStorage.setItem(storageKey(user?.id), JSON.stringify(next)); } catch { /* storage disabled */ }
  };

  const tile = (app, isFavorite) => (
    <AppTile
      key={app.id}
      app={app}
      email={user?.email}
      permissions={user?.permissions || []}
      userName={user?.name || user?.email || 'P'}
      avatarUrl={user?.avatarUrl}
      editing={editing}
      isFavorite={isFavorite}
      onToggle={toggle}
      onOpen={() => onOpenChange(false)}
    />
  );

  return (
    <div className="pw-apps" ref={rootRef}>
      <IconButton
        ref={buttonRef}
        size="sm"
        icon="apps"
        label="Aplikasi Google"
        aria-haspopup="dialog"
        aria-expanded={open}
        selected={open}
        onClick={() => onOpenChange(!open)}
      />
      {presence.present && createPortal(
        <div
          ref={panelRef}
          className="pw-apps__panel"
          role="dialog"
          aria-label="Aplikasi Google"
          tabIndex={-1}
          data-state={presence.closing ? 'closing' : 'open'}
          {...anchoredProps(position)}
          onAnimationEnd={presence.onAnimationEnd}
        >
          <section className="pw-apps__card">
            <div className="pw-apps__head">
              <h2>Favorit Anda</h2>
              <IconButton
                size="sm"
                icon={editing ? 'check' : 'edit'}
                label={editing ? 'Selesai' : 'Ubah favorit'}
                selected={editing}
                className="pw-apps__edit"
                onClick={() => setEditing((value) => !value)}
              />
            </div>
            {favorites.length
              ? <div className="pw-apps__grid">{favorites.map((app) => tile(app, true))}</div>
              : <p className="pw-apps__empty">Klik ikon pensil lalu pilih aplikasi untuk ditambahkan.</p>}
          </section>
          {others.length > 0 && (
            <section className="pw-apps__more">
              {editing ? <h2>Tambahkan ke favorit</h2> : null}
              <div className="pw-apps__grid">{others.map((app) => tile(app, false))}</div>
            </section>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
