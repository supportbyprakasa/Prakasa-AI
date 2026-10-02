import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { activeNavItem, buildNavSections, navGroups } from './navigation';
import { useNotificationCount } from '../context/NotificationContext';
import useSalesActionBadge from './useSalesActionBadge';
import Icon from './Icon';
import IconButton from './IconButton';
import Footer from './Footer';
import BrandWordmark from './BrandWordmark';
import CountBadge from './CountBadge';
import { FOCUSABLE, useOverlay } from './useOverlay';

// Ordered for the user's roles: their own division's work comes first.
export function useNavConfig() {
  const { user } = useAuth();
  return useMemo(() => buildNavSections(user?.permissions || [], user?.roles || []), [user?.permissions, user?.roles]);
}

// Which groups the user left open, remembered per browser. Storage can be
// missing or blocked (private window): the menu then just starts closed.
const GROUPS_KEY = 'prakasa-nav-groups';
function readOpenGroups() {
  try {
    const value = JSON.parse(window.localStorage.getItem(GROUPS_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function writeOpenGroups(value) {
  try { window.localStorage.setItem(GROUPS_KEY, JSON.stringify(value)); } catch { /* storage disabled */ }
}

function ItemBadge({ count, label }) {
  if (!count) return null;
  return (
    <span className="prakasa-sidebar__badge">
      <span aria-hidden="true"><CountBadge count={count} /></span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// In the rail each pill names itself through the shared tooltip, beside the
// pill (components/tooltip.js, placement right).
function NavItem({ item, active, rail, nested, badge, badgeLabel, onNavigate }) {
  const className = `prakasa-sidebar__item${active ? ' is-active' : ''}${nested ? ' is-nested' : ''}`;
  const railName = badge ? `${item.label}, ${badgeLabel}` : item.label;
  const props = {
    className,
    'aria-current': active ? 'page' : undefined,
    'aria-label': rail ? railName : undefined,
    'data-pw-tooltip': rail ? railName : undefined,
    'data-pw-tooltip-placement': rail ? 'right' : undefined,
    onClick: onNavigate,
  };
  const content = (
    <>
      <span className="prakasa-sidebar__icon">
        <Icon name={item.symbol || 'circle'} size="md" />
        {rail && badge ? <span className="prakasa-sidebar__dot" aria-hidden="true"><CountBadge dot /></span> : null}
      </span>
      <span className="prakasa-sidebar__label">{item.label}</span>
      {!rail ? <ItemBadge count={badge} label={badgeLabel} /> : null}
    </>
  );
  // Gmail / Google Chat open the real Google app in a new tab.
  if (item.external) {
    return <a href={item.to} target="_blank" rel="noreferrer" {...props}>{content}</a>;
  }
  return <Link to={item.to} {...props}>{content}</Link>;
}

// variant: 'docked' (≥ 1024 px, beside the content; `collapsed` narrows it to
// the 64 px icon rail) or 'drawer' (< 1024 px, a 280 px overlay opened from
// the top bar's ☰). Sections with several modules are expandable groups.
export default function Sidebar({ collapsed = false, variant = 'docked', open = true, onToggle, onNavigate, returnFocusRef }) {
  const sections = useNavConfig();
  const { pathname } = useLocation();
  const { unreadCount } = useNotificationCount();
  const { user } = useAuth();
  const salesActions = useSalesActionBadge((user?.permissions || []).includes('sales.customer.view'));
  const drawer = variant === 'drawer';
  const rail = collapsed && !drawer;
  const idBase = useId();
  const panelRef = useRef(null);

  const groups = useMemo(() => navGroups(sections), [sections]);
  const active = useMemo(() => activeNavItem(pathname, sections), [pathname, sections]);
  const activeGroup = groups.find((group) => group.type === 'group' && group.items.includes(active))?.key || null;

  // Groups the user opened stay open (remembered); the group holding the
  // current page is open while the user is on it, unless they close it there.
  // The role's own division group starts open until the user closes it.
  const focusGroup = groups.find((group) => group.type === 'group' && group.focus)?.key || null;
  const [openGroups, setOpenGroups] = useState(readOpenGroups);
  const [closedActive, setClosedActive] = useState(null);
  useEffect(() => { setClosedActive(null); }, [activeGroup]);
  const isGroupOpen = (key) => {
    if (key === activeGroup) return closedActive !== key;
    return key in openGroups ? Boolean(openGroups[key]) : key === focusGroup;
  };
  const toggleGroup = (key) => {
    const next = !isGroupOpen(key);
    if (key === activeGroup) setClosedActive(next ? null : key);
    setOpenGroups((current) => {
      const value = { ...current, [key]: next };
      writeOpenGroups(value);
      return value;
    });
  };

  // The drawer overlay (< 1024 px) is a modal dialog in the shared overlay stack:
  // focus stays inside, Escape closes it (when it is the top-most overlay), the
  // page behind does not scroll, and focus goes back to the ☰ that opened it.
  const drawerOpen = drawer && open;
  useOverlay({
    open: drawerOpen,
    containerRef: panelRef,
    onEscape: onToggle,
    modal: true,
    restoreFocus: !returnFocusRef,
    initialFocus: (root) => root.querySelector(FOCUSABLE),
  });
  useEffect(() => {
    if (!drawerOpen || !returnFocusRef) return undefined;
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [drawerOpen, returnFocusRef]);

  // Keep the current page's entry in view (the rail and long menus scroll).
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector('.prakasa-sidebar__item.is-active');
    if (!item) return;
    const box = nav.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.top < box.top || rect.bottom > box.bottom) nav.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
  }, [active?.to, rail, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const badgeFor = (item) => (item.showUnreadBadge ? unreadCount : (item.badge === 'salesActions' ? salesActions : 0));
  // Whole sentences, so each has one translation (i18n).
  const badgeLabelFor = (item) => (item.badge === 'salesActions' ? `${badgeFor(item)} pekerjaan Sales perlu tindakan` : `${badgeFor(item)} notifikasi belum dibaca`);
  const renderItem = (item, nested = false) => (
    <li key={item.to}>
      <NavItem
        item={item}
        active={item === active}
        rail={rail}
        nested={nested}
        badge={badgeFor(item)}
        badgeLabel={badgeLabelFor(item)}
        onNavigate={onNavigate}
      />
    </li>
  );

  const list = (
    <ul className="prakasa-sidebar__list">
      {groups.map((entry) => {
        if (entry.type === 'item') return renderItem(entry.item);
        // The rail has no room for group rows: every module shows as its own icon.
        if (rail) return entry.items.map((item) => renderItem(item));
        const isOpen = isGroupOpen(entry.key);
        const listId = `${idBase}-${entry.key.replace(/[^a-z0-9]+/gi, '-')}`;
        return (
          <li key={entry.key} className={`prakasa-sidebar__group${isOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="prakasa-sidebar__item prakasa-sidebar__group-toggle"
              aria-expanded={isOpen}
              aria-controls={listId}
              onClick={() => toggleGroup(entry.key)}
            >
              <span className="prakasa-sidebar__icon prakasa-sidebar__chevron"><Icon name="arrow_right" size="md" /></span>
              <span className="prakasa-sidebar__label">{entry.title}</span>
            </button>
            <ul id={listId} className="prakasa-sidebar__list" role="group" aria-label={entry.title} hidden={!isOpen}>
              {entry.items.map((item) => renderItem(item, true))}
            </ul>
          </li>
        );
      })}
    </ul>
  );

  const body = (
    <>
      <nav ref={navRef} className="prakasa-sidebar__nav" aria-label="Menu utama">{list}</nav>
      {!rail ? <Footer /> : null}
    </>
  );

  if (drawer) {
    return (
      <div className={`prakasa-drawer${open ? ' is-open' : ''}`}>
        <div className="prakasa-drawer__scrim" onClick={onToggle} aria-hidden="true" />
        <aside
          ref={panelRef}
          className="prakasa-sidebar prakasa-sidebar--drawer"
          role={open ? 'dialog' : undefined}
          aria-modal={open ? 'true' : undefined}
          aria-label="Menu navigasi"
          aria-hidden={open ? undefined : 'true'}
          tabIndex={-1}
        >
          <div className="prakasa-sidebar__drawer-head">
            <span className="prakasa-navbar__menu">
              <IconButton icon="menu" label="Tutup menu utama" onClick={onToggle} />
            </span>
            <Link to="/" className="prakasa-navbar__brand" onClick={onNavigate}>
              <BrandWordmark restClassName="prakasa-navbar__brand-rest" />
            </Link>
          </div>
          {body}
        </aside>
      </div>
    );
  }

  return (
    <aside className={`prakasa-sidebar prakasa-sidebar--docked${rail ? ' is-collapsed' : ''}`} aria-label="Navigasi utama">
      {body}
    </aside>
  );
}
