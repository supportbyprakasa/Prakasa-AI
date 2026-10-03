import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Button from '../components/Button';
import Card from '../components/Card';
import Icon from '../components/Icon';
import IconButton from '../components/IconButton';
import { SkeletonLine } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { statusTone } from '../components/statusTone';
import { usePrakasaAIToolContext } from '../context/PrakasaAIToolContext';
import { NoTranslate, Translate } from '../i18n/NoTranslate';
import { tr } from '../i18n/tr.js';
import { greetingFor } from './dashboardModel';
import {
  BRIEFING_VISIBLE_ROWS, briefingQuestion, briefingStatus, normalizeBriefing, readCollapsed, waitingText, wibHour, writeCollapsed,
} from './morningBriefingModel';

// "Ringkasan pagi" (Prakasa AI Wave D1): what waits for the signed-in person
// today, in priority order — built from the data on the server, no AI model.
// Each row links to its page; "Tanya Prakasa AI tentang ini" opens the panel
// with a question in the message box (the user sends it).
function Row({ item, onAsk }) {
  const status = briefingStatus(item.severity);
  const waiting = waitingText(item.ageHours);
  const body = (
    <>
      <span className={`dash-brief__count is-${statusTone(status)}`} aria-hidden="true">{item.count > 999 ? '999+' : item.count}</span>
      <span className="pw-cell">
        <span className="pw-cell__title dash-brief__label">
          <span className="pw-visually-hidden">{item.count} </span>{item.label}
        </span>
        <span className="pw-cell__meta dash-brief__meta">
          <StatusBadge status={status} />
          {waiting ? <span>{waiting}</span> : null}
          {item.examples.map((example) => (
            example.translate
              ? <Translate key={example.title} className="dash-brief__example">{example.title}</Translate>
              : <NoTranslate key={example.title} className="dash-brief__example">{example.title}</NoTranslate>
          ))}
        </span>
      </span>
    </>
  );
  return (
    <li className="dash-brief__item">
      {item.route
        ? <Link to={item.route} className="dash-brief__row pw-state-layer">{body}</Link>
        : <div className="dash-brief__row">{body}</div>}
      {onAsk ? (
        <IconButton size="sm" icon="auto_awesome" label="Tanya Prakasa AI tentang ini" onClick={() => onAsk(item)} />
      ) : null}
    </li>
  );
}

function BriefingSkeleton() {
  return (
    <div className="dash-brief__skeleton" role="status" aria-label="Memuat ringkasan pagi">
      <SkeletonLine width="68%" height={16} />
      <SkeletonLine width="92%" />
      <SkeletonLine width="80%" />
      <SkeletonLine width="86%" />
    </div>
  );
}

export default function MorningBriefing({ user, reloadKey = 0 }) {
  const ai = usePrakasaAIToolContext();
  const [state, setState] = useState({ loading: true, error: false, briefing: null });
  const [collapsed, setCollapsed] = useState(() => readCollapsed(user?.id));
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get('/work-summary/briefing');
      setState({ loading: false, error: false, briefing: normalizeBriefing(response.data.data) });
    } catch {
      // The card is a convenience: the rest of the home page stays as it is.
      setState({ loading: false, error: true, briefing: null });
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const toggle = () => {
    setCollapsed((value) => {
      writeCollapsed(user?.id, !value);
      return !value;
    });
  };

  const firstName = (user?.name || user?.email?.split('@')[0] || 'Rekan').split(' ')[0];
  const { briefing } = state;
  const canAsk = Boolean(ai?.enabled && ai.resolved && typeof ai.ask === 'function');
  // The question goes into the message box in the user's interface language.
  const ask = canAsk ? (item) => ai.ask(tr(briefingQuestion(item))) : null;
  const rows = briefing ? (showAll ? briefing.items : briefing.items.slice(0, BRIEFING_VISIBLE_ROWS)) : [];
  const hidden = briefing ? briefing.items.length - rows.length : 0;
  const quiet = briefing?.allClear;

  return (
    <Card
      as="section"
      className={`dash-card dash-brief${quiet ? ' is-quiet' : ''}`}
      aria-label="Ringkasan pagi"
      title={(
        <span className="dash-card__title">
          <Icon name="wb_twilight" className="dash-card__icon" />
          <span>Ringkasan pagi</span>
        </span>
      )}
      actions={(
        <IconButton
          size="sm"
          icon={collapsed ? 'expand_more' : 'expand_less'}
          label={collapsed ? 'Buka ringkasan pagi' : 'Ciutkan ringkasan pagi'}
          aria-expanded={!collapsed}
          aria-controls="ringkasan-pagi-isi"
          onClick={toggle}
        />
      )}
    >
      <div id="ringkasan-pagi-isi">
        {state.loading ? <BriefingSkeleton /> : null}
        {state.error ? (
          <p className="pw-text-helper dash-brief__note">
            Ringkasan pagi belum bisa dimuat. Daftar pekerjaan di bawah tetap lengkap.{' '}
            <Button variant="text" onClick={() => { setState((s) => ({ ...s, loading: true, error: false })); load(); }}>Coba lagi</Button>
          </p>
        ) : null}
        {briefing ? (
          <>
            <p className="dash-brief__headline">
              <span>{greetingFor(wibHour())}</span>, <NoTranslate>{firstName}</NoTranslate>.{' '}
              <span>{briefing.headline.lead}</span>
              {briefing.headline.parts.length ? ': ' : '.'}
              {briefing.headline.parts.map((part, index) => (
                <span key={part.key}>{index ? ', ' : ''}<span>{part.text}</span></span>
              ))}
              {briefing.headline.parts.length ? '.' : ''}
            </p>
            {!collapsed && rows.length ? (
              <ul className="dash-brief__list">
                {rows.map((item) => <Row key={item.key} item={item} onAsk={ask} />)}
              </ul>
            ) : null}
            {!collapsed && hidden > 0 ? (
              <div className="dash-card__more">
                <Button variant="text" onClick={() => setShowAll(true)}>{`Tampilkan ${hidden} lainnya`}</Button>
              </div>
            ) : null}
            {!collapsed && (briefing.pending.length || briefing.failed.length) ? (
              <p className="pw-text-helper dash-brief__note">
                Sebagian belum sempat dimuat dan akan muncul saat halaman dimuat ulang:{' '}
                {[...briefing.pending, ...briefing.failed].map((name, index) => (
                  <span key={name}>{index ? ', ' : ''}<span>{name}</span></span>
                ))}
                .
              </p>
            ) : null}
            {!collapsed ? (
              <p className="pw-text-helper dash-brief__note">
                Disusun langsung dari data sesuai izin Anda, tanpa model AI. Bisa disembunyikan di <Link to="/akun">Akun saya</Link>.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
