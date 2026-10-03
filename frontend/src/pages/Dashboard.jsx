import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNavConfig } from '../components/Sidebar';
import Page from '../components/Page';
import Button from '../components/Button';
import Card from '../components/Card';
import CountBadge from '../components/CountBadge';
import Icon from '../components/Icon';
import EmptyState, { LoadingState } from '../components/EmptyState';
import { formatDate } from '../components/format';
import {
  cardSymbol, formatRelative, greetingFor, groupCards, normalizeSummary, QUICK_LINKS,
} from './dashboardModel';
import MorningBriefing from './MorningBriefing';
import './dashboard.css';

// One generation-B home card (docs/ui-guideline.md §3.4): tinted, radius 12,
// the module's Material Symbol and a count, then the oldest waiting items.
function SummaryCard({ card }) {
  return (
    <Card
      as="article"
      className="dash-card"
      title={(
        <span className="dash-card__title">
          <Icon name={cardSymbol(card.key)} className="dash-card__icon" />
          <span>{card.title}</span>
        </span>
      )}
      actions={<CountBadge count={card.count} label={`${card.count} item`} />}
    >
      <ul className="dash-list">
        {card.items.map((item) => (
          <li key={item.id}>
            <Link to={item.to} className="dash-list__row pw-state-layer">
              <span className="pw-cell">
                {/* A record's own title, or "Barang masuk #12" composed by the
                    server: a sentence zone (what a user typed stays). */}
                <span className="pw-cell__title dash-list__title" data-translate="strict">{item.title}</span>
                <span className="pw-cell__meta">
                  {item.meta}{item.at ? ' · ' : ''}{item.at ? formatRelative(item.at) : ''}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {card.count > card.items.length ? (
        <div className="dash-card__more">
          <Button variant="text" to={card.to}>{`Lihat semua (${card.count})`}</Button>
        </div>
      ) : null}
    </Card>
  );
}

function Section({ title, hint, cards }) {
  if (!cards.length) return null;
  return (
    <section className="dash-section" aria-label={title}>
      <div className="dash-section__head">
        <h2 className="pw-title-section">{title}</h2>
        {hint ? <span className="pw-text-helper dash-section__hint">{hint}</span> : null}
      </div>
      <div className="dash-grid">{cards.map((card) => <SummaryCard key={card.key} card={card} />)}</div>
    </section>
  );
}

function NotificationsCard({ notifications }) {
  return (
    <Card
      className="dash-card dash-notif"
      title={(
        <span className="dash-card__title">
          <Icon name="notifications" className="dash-card__icon" />
          <span>Notifikasi</span>
        </span>
      )}
      actions={notifications.unread > 0
        ? <CountBadge count={notifications.unread} label={`${notifications.unread} belum dibaca`} />
        : null}
    >
      {notifications.recent.length ? (
        <ul className="dash-list">
          {notifications.recent.map((item) => (
            <li key={item.id} className={item.isRead ? 'is-read' : undefined}>
              <Link to={item.to || '/notifications'} className="dash-list__row pw-state-layer">
                <span className="dash-notif__dot">
                  {item.isRead ? null : <CountBadge dot label="Belum dibaca" />}
                </span>
                <span className="pw-cell">
                  <span className="pw-cell__title dash-list__title">{item.title}</span>
                  <span className="pw-cell__meta">{formatRelative(item.at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState compact icon="notifications" description="Belum ada notifikasi." />}
      <div className="dash-card__more">
        <Button variant="text" to="/notifications">Lihat semua notifikasi</Button>
      </div>
    </Card>
  );
}

// Home: what waits for the signed-in person across every module
// (/work-summary), their latest notifications, and — on narrow screens where
// the menu is a drawer — shortcuts to the daily tools.
export default function Dashboard() {
  const { user } = useAuth();
  const sections = useNavConfig();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // "Muat ulang" asks for the morning briefing again too.
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await api.get('/work-summary');
      setSummary(normalizeSummary(response.data.data));
      setError('');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Ringkasan kerja gagal dimuat.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const firstName = (user?.name || user?.email?.split('@')[0] || 'Rekan').split(' ')[0];
  const grouped = useMemo(() => groupCards(summary?.cards), [summary]);
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const quickLinks = QUICK_LINKS.map((link) => items.find((item) => item.to === link)).filter(Boolean);
  const loading = !summary && !error;
  const allClear = summary && !summary.cards.length;
  const now = new Date();
  // "Ringkasan pagi": on unless switched off in Akun saya.
  const briefingOn = user?.morningBriefing !== false;

  return (
    <Page
      className="dash"
      title="Dashboard"
      // The morning briefing card greets the person itself.
      description={briefingOn
        ? `Pekerjaan yang menunggu Anda hari ini, ${formatDate(now)}.`
        : `${greetingFor(now.getHours())}, ${firstName}. Ringkasan pekerjaan yang menunggu Anda hari ini, ${formatDate(now)}.`}
      actions={(
        <Button variant="secondary" type="button" icon="refresh" onClick={() => { setReloads((n) => n + 1); load(); }} loading={refreshing}>
          Muat ulang
        </Button>
      )}
    >
      {briefingOn ? <MorningBriefing user={user} reloadKey={reloads} /> : null}

      {quickLinks.length > 0 && (
        <nav className="dash-quick pw-row" aria-label="Pintasan">
          {quickLinks.map((item) => (item.external
            ? <Button key={item.to} variant="secondary" icon={item.symbol} href={item.to} target="_blank" rel="noreferrer">{item.label}</Button>
            : <Button key={item.to} variant="secondary" icon={item.symbol} to={item.to}>{item.label}</Button>))}
        </nav>
      )}

      {error ? (
        <EmptyState
          tone="error"
          title="Ringkasan kerja gagal dimuat"
          description={error}
          action={<Button variant="secondary" type="button" onClick={load}>Coba lagi</Button>}
        />
      ) : null}
      {loading ? <LoadingState label="Memuat ringkasan kerja…" /> : null}

      {summary ? (
        <div className="pw-cols-sidebar dash-body">
          <div className="dash-main">
            {/* With the briefing on, its own quiet line says that nothing waits. */}
            {allClear && !briefingOn ? (
              <Card className="dash-card">
                <EmptyState icon="check_circle" title="Semua beres" description="Tidak ada yang menunggu tindakan Anda saat ini." />
              </Card>
            ) : null}
            <Section title="Perlu tindakan Anda" hint="Urut dari yang paling lama menunggu" cards={grouped.action} />
            <Section title="Permintaan saya" cards={grouped.mine} />
            <Section title="Antrean tim" cards={grouped.team} />
          </div>
          <aside className="dash-aside" aria-label="Notifikasi terbaru">
            <NotificationsCard notifications={summary.notifications} />
          </aside>
        </div>
      ) : null}
    </Page>
  );
}
