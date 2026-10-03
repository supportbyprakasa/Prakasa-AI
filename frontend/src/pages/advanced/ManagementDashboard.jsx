import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Page from '../../components/Page';
import StatCard from '../../components/StatCard';
import { useRealtime } from '../../api/realtime';
import TrackerPortfolio from '../projects/TrackerPortfolio';
import { apiErrorMessage, debounce, unwrap } from '../projects/trackerModel';
import { severityTone } from './escalationsModel';
import {
  daysLateText, escalationHref, escalationMetaParts, groupKpis, kpiIsAlert, kpiIsEmpty, kpiNoteText, kpiValueText,
  normalizeSummary,
} from './managementDashboardModel';
import { NoTranslate, Translate, doTranslate, noTranslate } from '../../i18n/NoTranslate';
import './management-dashboard.css';

// One module KPI. `alert` flags a figure that needs attention: the number is
// always printed and StatCard turns only the note red. A card with no number
// can still alert (its explanation turns red, the dash stays quiet); a failed
// card never does (kpiIsAlert).
function Kpi({ kpi }) {
  return (
    <StatCard
      label={kpi.label}
      value={kpiValueText(kpi)}
      note={kpiNoteText(kpi)}
      alert={kpiIsAlert(kpi)}
      empty={kpiIsEmpty(kpi)}
    />
  );
}

function TopEscalations({ items, openCount, entityWide }) {
  return (
    <Card
      title="Eskalasi teratas"
      actions={(
        <>
          <span className={openCount > 0 ? 'mgmt-esc__count is-alert' : 'mgmt-esc__count'}>{`${openCount} belum ditangani`}</span>
          <Button variant="text" to="/escalations">Lihat semua</Button>
        </>
      )}
    >
      {items.length ? (
        <ul className="mgmt-esc">
          {items.map((item) => {
            const meta = escalationMetaParts(item);
            return (
              <li key={`${item.source}:${item.sourceId}`}>
                <Link to={escalationHref(item)} className="mgmt-esc__row pw-state-layer">
                  <span className="pw-cell">
                    <span className="pw-cell__title">
                      <NoTranslate>{item.title}</NoTranslate>
                      {item.reference ? <span {...(item.referenceLabel ? doTranslate : noTranslate)} className="mgmt-esc__ref"> · {item.reference}</span> : null}
                    </span>
                    {meta.length ? (
                      <span className="pw-cell__meta">
                        {meta.flatMap((part, n) => {
                          const node = <Translate key={part.text} strict={Boolean(part.strict)}>{part.text}</Translate>;
                          return n ? [' · ', node] : [node];
                        })}
                      </span>
                    ) : null}
                  </span>
                  <span className={`mgmt-esc__late is-${severityTone(item.severity)}`}>
                    {daysLateText(item)}
                    <span className="sr-only"> terlambat</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon="celebration"
          title="Tidak ada yang lewat tenggat"
          description={entityWide
            ? 'Semua pekerjaan di setiap modul divisi masih dalam tenggat.'
            : 'Semua pekerjaan di divisi Anda masih dalam tenggat.'}
          compact
        />
      )}
    </Card>
  );
}

// Cross-module management view. Every number on it comes from the management
// providers on the server — one per division module — so the page lists whatever
// modules the API returns and knows none of them by name. A division Head gets
// the same page scoped to their own division. The embedded TrackerPortfolio
// refreshes itself on tracker events; the summary reads a different endpoint, so
// it subscribes too.
export default function ManagementDashboard() {
  const [state, setState] = useState({ loading: true, error: '', code: '', data: null });

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: '', code: '' }));
    try {
      const data = unwrap(await api.get('/management-dashboard/summary'));
      setState({ loading: false, error: '', code: '', data: normalizeSummary(data) });
    } catch (error) {
      // A background refetch that fails keeps the last good numbers on screen —
      // only an explicit load reports the failure.
      if (silent) return;
      setState((s) => ({
        ...s,
        loading: false,
        code: error?.response?.data?.error?.code || '',
        error: apiErrorMessage(error, 'Ringkasan manajemen gagal dimuat.'),
      }));
    }
  }, []);

  useEffect(() => { load(false); }, [load]);
  const refresh = useMemo(() => debounce(() => load(true), 1000), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useRealtime('tracker', () => refresh());

  const { data } = state;
  const noDepartment = state.code === 'NO_DEPARTMENT';
  const groups = useMemo(() => groupKpis(data?.kpis), [data]);
  const scope = data?.scope;
  const ready = Boolean(data) && !noDepartment && !state.error;

  return (
    <Page
      title="Dashboard manajemen"
      description={scope && !scope.entityWide
        ? 'Angka kunci setiap modul dan pekerjaan yang lewat tenggat untuk divisi Anda.'
        : 'Angka kunci setiap modul divisi dan pekerjaan yang lewat tenggat, untuk seluruh perusahaan.'}
      actions={(
        <Button variant="secondary" type="button" icon="refresh" onClick={() => load(false)} loading={state.loading}>
          Muat ulang
        </Button>
      )}
    >
      {noDepartment ? (
        // A 403 NO_DEPARTMENT is an account-setup problem, not a transient failure:
        // "Coba lagi" would never help, so it gets an explanation instead.
        <EmptyState
          icon="domain"
          title="Akun Anda belum terhubung ke divisi"
          description="Ringkasan manajemen ditampilkan per divisi, jadi akun Anda perlu terdaftar pada salah satu divisi. Hubungi admin untuk menautkannya."
        />
      ) : null}

      {!noDepartment && state.error ? (
        <EmptyState
          tone="error"
          title="Ringkasan manajemen gagal dimuat"
          description={state.error}
          action={<Button variant="secondary" type="button" onClick={() => load(false)}>Coba lagi</Button>}
        />
      ) : null}

      {ready && !scope.entityWide ? (
        <Banner tone="info">
          {scope.departmentName ? `Hanya divisi ${scope.departmentName}` : 'Tampilan dibatasi pada divisi Anda.'}
        </Banner>
      ) : null}

      {state.loading && !data ? <LoadingState label="Memuat ringkasan manajemen…" skeleton="dashboard" /> : null}

      {ready ? (
        <>
          {groups.length ? groups.map((group) => (
            <section className="pw-stack" key={group.providerLabel} aria-label={group.providerLabel}>
              <h2 className="pw-title-section">{group.providerLabel}</h2>
              <div className="pw-cols-4 mgmt-kpis">
                {group.kpis.map((kpi) => <Kpi key={kpi.id} kpi={kpi} />)}
              </div>
            </section>
          )) : (
            <EmptyState
              icon="speed"
              title="Belum ada angka kunci"
              description="Belum ada modul divisi yang melaporkan angka kunci ke manajemen."
            />
          )}

          <TopEscalations
            items={data.topEscalations}
            openCount={data.escalationTotals.open}
            entityWide={scope.entityWide}
          />
        </>
      ) : null}

      <TrackerPortfolio />
    </Page>
  );
}
