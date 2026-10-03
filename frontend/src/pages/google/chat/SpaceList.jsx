import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/Button';
import CountBadge from '../../../components/CountBadge';
import Icon from '../../../components/Icon';
import Menu from '../../../components/Menu';
import SearchField from '../../../components/SearchField';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import {
  SECTIONS, filterSpaces, formatLastActive, groupSpaces, isUnread, readCollapsed, spaceIdFromName, spaceTypeLabel, writeCollapsed,
} from '../chatModel';
import { NEW_CHAT_MODES } from './NewChatDialog';
import { Avatar } from './parts';
import { dataAttributes } from '../../../i18n/NoTranslate';
import { tr } from '../../../i18n/tr';

const storage = () => { try { return window.localStorage; } catch { return null; } };

function SpaceRow({ space, active, unread }) {
  const id = spaceIdFromName(space.name);
  if (!id) return null;
  return (
    <li>
      <Link
        to={`/chat?space=${id}`}
        className={`pw-gchat__row pw-state-layer pw-ripple${active ? ' is-active' : ''}${unread ? ' is-unread' : ''}`}
        aria-current={active ? 'page' : undefined}
        // The space's name is record data: only the word after it is translated.
        aria-label={unread ? `${space.displayName}, ${tr('belum dibaca')}` : undefined}
        {...dataAttributes}
      >
        <Avatar space={space} size="sm" />
        <span className="pw-gchat__row-text">
          <span data-no-translate="" className="pw-gchat__row-name">{space.displayName}</span>
          <span className="pw-gchat__row-meta">{spaceTypeLabel(space)}</span>
        </span>
        <span className="pw-gchat__row-end">
          <span className="pw-gchat__row-time">{formatLastActive(space.lastActiveTime)}</span>
          {unread ? <CountBadge dot /> : null}
        </span>
      </Link>
    </li>
  );
}

// Google Chat's sidebar: "Pesan langsung", "Space" and "Aplikasi", each
// collapsible (remembered per user) and newest first. The open conversation
// stays visible even inside a collapsed section.
export default function SpaceList({ spaces, loading, error, onRetry, activeName, readStates, onNewChat, userId }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storage(), userId));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef(null);
  const scrollRef = useRef(null);
  // The user can arrive before the auth context knows them — reload once it does.
  useEffect(() => { setCollapsed(readCollapsed(storage(), userId)); }, [userId]);
  // Keep the open conversation visible in the list (deep links, phone back).
  useEffect(() => {
    if (!activeName) return;
    scrollRef.current?.querySelector('.pw-gchat__row.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeName, loading]);
  const groups = useMemo(() => groupSpaces(filterSpaces(spaces, query)), [spaces, query]);
  const unreadOf = (space) => Boolean(readStates) && space.name !== activeName && isUnread(space, readStates[space.name]);
  const searching = query.trim().length > 0;
  const total = groups.direct.length + groups.spaces.length + groups.apps.length;

  const toggle = (key) => setCollapsed((current) => {
    const next = { ...current, [key]: !current[key] };
    writeCollapsed(storage(), userId, next);
    return next;
  });

  let body;
  if (loading && !spaces.length) body = <LoadingState label="Memuat percakapan…" compact />;
  else if (error && !spaces.length) {
    body = <EmptyState tone="error" compact title="Gagal memuat Chat" description={error} action={<Button variant="text" onClick={onRetry}>Coba lagi</Button>} />;
  } else if (!total) {
    body = <EmptyState compact icon={searching ? 'search_off' : 'forum'} title={searching ? 'Tidak ditemukan' : 'Belum ada percakapan'} description={searching ? 'Coba kata kunci lain.' : 'Mulai dengan tombol “Chat baru”.'} />;
  } else {
    body = SECTIONS.map(({ key, label }) => {
      const list = groups[key];
      if (!list.length) return null;
      const closed = Boolean(collapsed[key]) && !searching;
      const shown = closed ? list.filter((space) => space.name === activeName) : list;
      const unreadCount = list.filter(unreadOf).length;
      const headId = `pw-gchat-section-${key}`;
      return (
        <section key={key} className={`pw-gchat__section${key === 'apps' ? ' is-apps' : ''}`} aria-labelledby={headId}>
          <div
            id={headId}
            role="button"
            tabIndex={0}
            aria-expanded={!closed}
            className="pw-gchat__section-head pw-state-layer pw-ripple"
            onClick={() => toggle(key)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(key); } }}
          >
            <Icon name="expand_more" size="sm" className="pw-gchat__section-chevron" />
            <span className="pw-gchat__section-title" data-i18n-context="chat">{label}</span>
            <span className="pw-gchat__section-count" aria-label={`${list.length} percakapan${unreadCount ? `, ${unreadCount} belum dibaca` : ''}`}>
              {closed && unreadCount ? <CountBadge dot /> : null}
              {list.length}
            </span>
          </div>
          {shown.length ? (
            <ul className="pw-gchat__rows">
              {shown.map((space) => <SpaceRow key={space.name} space={space} active={space.name === activeName} unread={unreadOf(space)} />)}
            </ul>
          ) : null}
        </section>
      );
    });
  }

  return (
    <aside className="pw-gchat__list" aria-label="Daftar percakapan">
      <div className="pw-gchat__list-head">
        <span ref={menuAnchor} className="pw-gchat__new">
          <Button
            icon="add"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'pw-gchat-new-menu' : undefined}
          >
            Chat baru
          </Button>
        </span>
        <Menu
          id="pw-gchat-new-menu"
          open={menuOpen}
          anchorRef={menuAnchor}
          onClose={() => setMenuOpen(false)}
          align="start"
          label="Chat baru"
          items={NEW_CHAT_MODES.map(({ mode, label, icon }) => ({ key: mode, label, icon, onClick: () => onNewChat(mode) }))}
        />
        <SearchField
          variant="panel"
          label="Cari orang, space, atau aplikasi"
          placeholder="Cari percakapan"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pw-gchat__search"
        />
      </div>
      <div className="pw-gchat__list-scroll" ref={scrollRef}>{body}</div>
    </aside>
  );
}
