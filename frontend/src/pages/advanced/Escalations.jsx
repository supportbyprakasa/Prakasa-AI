import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useRealtime } from '../../api/realtime';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import FormActions from '../../components/FormActions';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import DataGrid from '../../components/datagrid/DataGrid';
import EmptyState from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { allowedLink } from '../../components/navigation';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { apiErrorMessage, debounce, unwrap } from '../projects/trackerModel';
import {
  applyFollowup, escalationKey, escalationQuery, escalationRecordId, findEscalation, followupForm, followupPayload, groupSourceCounts,
  itemStatus, NOTE_MAX, normalizeEscalations, readEscalationParams, resolveSource, severityTone,
  shiftTotals, sourceLabel, sourceProviderLabel, STATUS_FILTERS, STATUS_LABELS, STATUS_OPTIONS,
  statusKey, validateFollowupForm, writeEscalationParams,
} from './escalationsModel';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';
import './escalations.css';

const STATUS_FILTER_LABELS = { ...STATUS_LABELS, all: 'Semua' };

// Prakasa AI may write the follow-up note. The status (it closes the
// escalation) and who owns the follow-up are decisions: the user's only.
const AI_FOLLOWUP = defineAIForm({
  id: 'management-escalation-followup',
  title: 'Tindak lanjut eskalasi',
  // The entity-wide view, or a division Head for their own division (any of).
  permission: ['management_dashboard.view', 'management_dashboard.division'],
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: [
    f.textarea('note', 'Catatan', { maxLength: NOTE_MAX, hint: 'Apa yang sudah dilakukan dan langkah berikutnya.' }),
    f.userOnly('status', 'Status tindak lanjut', 'select'),
    f.userOnly('ownerUserId', 'Penanggung jawab tindak lanjut', 'select'),
  ],
});

// One queue of everything across the system that has breached its deadline, so
// management acts on it here instead of hunting through each module. The page
// knows no source: the API sends the catalogue (`sources`), one entry per kind of
// breach that a division module registered, and every chip, label and count is
// built from it. Tracker events refetch — debounced, because a busy board fires
// many events per second.
export default function Escalations() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const { status, source: urlSource } = readEscalationParams(params);

  // `loaded` flips after the first good answer: only then is the catalogue known
  // well enough to reject the URL's source.
  const [state, setState] = useState({ loading: true, loaded: false, error: '', code: '', data: normalizeEscalations(null) });
  const source = resolveSource(urlSource, state.data.sources, state.loaded);
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState(followupForm(null));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: '', code: '' }));
    const get = (query) => api.get('/management-dashboard/escalations', { params: query });
    const query = escalationQuery({ status, source });
    try {
      let response;
      try {
        response = await get(query);
      } catch (error) {
        // A shared link can name a source the server no longer has (400). Ask
        // again without it: the answer's catalogue then drops the stale filter.
        if (!query.source || error?.response?.status !== 400) throw error;
        response = await get(escalationQuery({ status }));
      }
      setState({ loading: false, loaded: true, error: '', code: '', data: normalizeEscalations(unwrap(response)) });
    } catch (error) {
      // A background refetch that fails keeps the last good queue on screen —
      // only an explicit load reports the failure.
      if (silent) return;
      setState((s) => ({
        ...s,
        loading: false,
        code: error?.response?.data?.error?.code || '',
        error: apiErrorMessage(error, 'Daftar eskalasi gagal dimuat.'),
      }));
    }
  }, [status, source]);

  useEffect(() => { load(false); }, [load]);
  const refresh = useMemo(() => debounce(() => load(true), 1000), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useRealtime('tracker', () => refresh());

  const setFilter = (patch) => setParams(writeEscalationParams(params, patch), { replace: true });

  // Once the catalogue has loaded, a source it does not list is removed from the
  // URL too, so the address bar never names a filter the page is not applying.
  useEffect(() => {
    if (state.loaded && urlSource && !source) setParams(writeEscalationParams(params, { source: '' }), { replace: true });
  }, [state.loaded, urlSource, source, params, setParams]);

  const { totals, items, scope, sources } = state.data;
  const sourceGroups = useMemo(() => groupSourceCounts(sources, totals.bySource), [sources, totals.bySource]);
  const noDepartment = state.code === 'NO_DEPARTMENT';

  const openFollowup = (row) => { setTarget(row); setForm(followupForm(row)); };
  const closeFollowup = () => { if (!saving) setTarget(null); };
  // /escalations?ubah=<jenis>-<id> opens that row's dialog, once the queue has loaded.
  // An escalation outside the filter on screen (another status or kind) still
  // opens: that one row is looked up in the whole queue this user may see.
  useOpenFromUrl('ubah', async (recordId) => {
    let row = findEscalation(state.data.items, recordId);
    if (!row) {
      try {
        const all = normalizeEscalations(unwrap(await api.get('/management-dashboard/escalations', { params: escalationQuery({ status: 'all' }) })));
        row = findEscalation(all.items, recordId);
      } catch { row = null; }
    }
    if (row) openFollowup(row);
    // The follow-up of another escalation never replaces an unsaved one (keepUnsaved).
  }, { enabled: state.loaded && !state.loading, keepUnsaved: true });
  const ai = usePrakasaAIForm(AI_FOLLOWUP, {
    enabled: Boolean(target),
    record: { type: 'escalation_followup', id: escalationRecordId(target) },
    values: form,
    setValues: setForm,
    initialValues: followupForm(target),
    validate: validateFollowupForm,
  });

  const saveFollowup = async (event) => {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    try {
      const body = followupPayload(form);
      const data = unwrap(await api.patch(
        `/management-dashboard/escalations/${target.source}/${target.sourceId}`,
        body,
      ));
      const previous = itemStatus(target);
      setState((s) => ({
        ...s,
        data: {
          ...s.data,
          items: applyFollowup(s.data.items, target.source, target.sourceId, data.followup),
          totals: shiftTotals(s.data.totals, previous, body.status),
        },
      }));
      setTarget(null);
      toast('Tindak lanjut tersimpan', 'success');
    } catch (error) {
      toast(apiErrorMessage(error, 'Tindak lanjut gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // No user directory is exposed to this page, so the owner picker offers only
  // the signed-in user, whoever already owns the follow-up, and "nobody".
  const ownerOptions = useMemo(() => {
    const options = [{ value: '', label: 'Belum ditugaskan', translate: true }];
    if (user?.id) options.push({ value: String(user.id), label: user.name || user.email, suffix: '(saya)' });
    const owner = target?.followup;
    if (owner?.ownerUserId && String(owner.ownerUserId) !== String(user?.id)) {
      options.push({ value: String(owner.ownerUserId), label: owner.ownerName || `Pengguna #${owner.ownerUserId}` });
    }
    return options;
  }, [user, target]);

  const columns = useMemo(() => [
    {
      key: 'source',
      header: 'Jenis',
      translate: true,
      sortValue: (r) => `${sourceProviderLabel(sources, r.source)} ${sourceLabel(sources, r.source)}`,
      exportValue: (r) => `${sourceLabel(sources, r.source)} (${sourceProviderLabel(sources, r.source)})`,
      render: (r) => (
        <span className="pw-cell">
          <span className="pw-cell__title">{sourceLabel(sources, r.source)}</span>
          <span className="pw-cell__meta">{sourceProviderLabel(sources, r.source)}</span>
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Judul',
      // The grid searches the same value it sorts on, and management types the
      // reference ("CEK-4") or the project name far more often than the title —
      // appending both keeps the sort by title while making them findable.
      sortValue: (r) => [r.title, r.reference, r.context].filter(Boolean).join(' '),
      exportValue: (r) => (r.reference ? `${r.title} (${r.reference})` : r.title),
      render: (r) => (
        <span className="pw-cell">
          {/* Management sees every division, but a division page it cannot open
              would send it home: the title then stays plain text. */}
          <span className="pw-cell__title">
            {allowedLink(r.link, user?.permissions) ? <Link to={r.link} className="pw-link">{r.title}</Link> : r.title}
          </span>
          <span className="pw-cell__meta">
            {r.reference ? <>{r.referenceLabel ? <Translate>{r.reference}</Translate> : <NoTranslate>{r.reference}</NoTranslate>}{' · '}</> : null}
            <Translate strict>{r.context}</Translate>
          </span>
        </span>
      ),
    },
    {
      key: 'departmentName',
      header: 'Divisi',
      translate: true,
      sortValue: (r) => r.departmentName || '',
      exportValue: (r) => r.departmentName || '',
      render: (r) => r.departmentName,
    },
    {
      key: 'ownerName',
      header: 'Penanggung jawab',
      sortValue: (r) => r.ownerName || '',
      exportValue: (r) => r.ownerName || 'Belum ditugaskan',
      render: (r) => (r.ownerName || <span data-translate="" className="pw-muted">Belum ditugaskan</span>),
    },
    {
      key: 'daysLate',
      header: 'Terlambat',
      translate: true,
      align: 'end',
      sortValue: (r) => r.daysLate,
      exportValue: (r) => `${r.daysLate} hari`,
      render: (r) => <span className={`esc-late is-${severityTone(r.severity)}`}>{r.daysLate} hari</span>,
    },
    {
      key: 'followupStatus',
      header: 'Status tindak lanjut',
      sortValue: (r) => STATUS_LABELS[itemStatus(r)],
      exportValue: (r) => STATUS_LABELS[itemStatus(r)],
      render: (r) => <StatusBadge status={statusKey(itemStatus(r))} label={STATUS_LABELS[itemStatus(r)]} />,
    },
    {
      key: 'updatedAt',
      header: 'Diperbarui',
      nowrap: true,
      sortValue: (r) => r.followup?.updatedAt || '',
      exportValue: (r) => r.followup?.updatedAt || '',
      render: (r) => (r.followup?.updatedAt ? formatDateTime(r.followup.updatedAt) : null),
    },
  ], [sources, user]);

  // The grid needs one stable id per row, and sourceId repeats across sources.
  const rows = useMemo(() => items.map((item) => ({ ...item, rowKey: escalationKey(item) })), [items]);
  const formErrors = validateFollowupForm(form);
  const firstLoad = state.loading && !state.loaded;
  const countOf = (value) => (value === 'all' ? totals.all : totals[value]);

  // Status chips carry their counts (the totals follow the source filter, not
  // the status one, so every chip's number is the list that chip opens); the
  // source filter picked in "Per modul" shows as a chip that removes it.
  const filters = (
    <>
      {STATUS_FILTERS.map((value) => (
        <Chip key={value} selected={status === value} onClick={() => setFilter({ status: value })}>
          {firstLoad ? STATUS_FILTER_LABELS[value] : `${STATUS_FILTER_LABELS[value]} (${countOf(value)})`}
        </Chip>
      ))}
      {source ? (
        <Chip
          selected
          trailingIcon="close"
          aria-label={`Hapus filter jenis ${sourceLabel(sources, source)}`}
          onClick={() => setFilter({ source: '' })}
        >
          {`Jenis: ${sourceLabel(sources, source)}`}
        </Chip>
      ) : null}
    </>
  );

  return (
    <Page
      title="Pusat eskalasi"
      description="Satu antrean berisi semua pekerjaan dari setiap modul divisi yang sudah melewati tenggatnya, supaya manajemen bisa menindaklanjuti tanpa membuka modulnya satu per satu."
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
          description="Pusat Eskalasi menampilkan pekerjaan per divisi, jadi akun Anda perlu terdaftar pada salah satu divisi. Hubungi admin untuk menautkannya."
        />
      ) : null}

      {!noDepartment && state.error ? (
        <EmptyState
          tone="error"
          title="Daftar eskalasi gagal dimuat"
          description={state.error}
          action={<Button variant="secondary" type="button" onClick={() => load(false)}>Coba lagi</Button>}
        />
      ) : null}

      {!noDepartment && !state.error && !scope.entityWide ? (
        <Banner tone="info">
          {scope.departmentName ? `Hanya divisi ${scope.departmentName}` : 'Tampilan dibatasi pada divisi Anda.'}
        </Banner>
      ) : null}

      {!noDepartment && !state.error ? (
        <>
          <div className="pw-cols-4 esc-kpis">
            <StatCard label="Semua" value={totals.all} loading={firstLoad} />
            <StatCard
              label="Belum ditangani"
              value={totals.open}
              loading={firstLoad}
              alert={totals.open > 0}
              note={totals.open > 0 ? 'Perlu ditindaklanjuti' : null}
            />
            <StatCard label="Sedang ditangani" value={totals.acknowledged} loading={firstLoad} />
            <StatCard label="Selesai" value={totals.resolved} loading={firstLoad} />
          </div>

          {sourceGroups.length ? (
            // One card is both the overview and the source filter. Every module is
            // listed (so management sees each division is monitored), but only
            // the kinds that actually hold something become chips — listing all
            // of them twice, as counts and again as filters, was a wall of 20+
            // chips that pushed the queue off a phone screen.
            <Card title="Per modul">
              <div className="esc-modules">
                {sourceGroups.map((group) => {
                  const visible = group.sources.filter((entry) => entry.count > 0 || entry.key === source);
                  return (
                    <section className="esc-module" key={group.providerLabel} aria-label={group.providerLabel}>
                      <div className="esc-module__head">
                        <span className="esc-module__name">{group.providerLabel}</span>
                        <span className="esc-module__count">{group.total}</span>
                      </div>
                      {visible.length ? (
                        <div className="pw-row" role="group" aria-label={`Filter ${group.providerLabel}`}>
                          {visible.map((entry) => (
                            <Chip
                              key={entry.key}
                              selected={source === entry.key}
                              onClick={() => setFilter({ source: source === entry.key ? '' : entry.key })}
                            >
                              {`${entry.label} (${entry.count})`}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </Card>
          ) : null}

          <DataGrid
            title="Antrean"
            columns={columns}
            rows={rows}
            idKey="rowKey"
            loading={state.loading}
            filters={filters}
            searchable={rows.length > 8}
            exportName="pusat-eskalasi"
            pageSize={20}
            empty={(
              <EmptyState
                icon="celebration"
                title="Tidak ada yang perlu dieskalasi"
                description={status === 'open'
                  ? 'Semua pekerjaan di setiap modul masih dalam tenggat — tidak ada yang menunggu keputusan Anda.'
                  : 'Tidak ada eskalasi yang cocok dengan filter ini.'}
                compact
              />
            )}
            // The label is kept short on purpose: it is rendered verbatim as the
            // tooltip, and a whole issue title made that bubble wider than a phone
            // screen, which dragged the page into a horizontal scroll. Screen
            // readers get the reference too.
            rowActions={(row) => (
              <IconButton
                size="sm"
                icon="assignment_turned_in"
                label="Tindak lanjut"
                aria-label={`Tindak lanjut ${(!row.referenceLabel && row.reference) || row.title}`}
                onClick={() => openFollowup(row)}
              />
            )}
          />
        </>
      ) : null}

      <Modal open={Boolean(target)} onClose={closeFollowup} title="Tindak lanjut eskalasi" size="sm">
        {target ? (
          <form className="pw-stack" onSubmit={saveFollowup}>
            {ai.notice}
            <KeyValue
              items={[
                { label: 'Jenis', value: sourceLabel(sources, target.source), translate: true },
                { label: 'Modul', value: sourceProviderLabel(sources, target.source), translate: true },
                { label: 'Judul', value: target.reference ? `${target.title} (${target.reference})` : target.title },
                { label: 'Konteks', value: target.context, translate: 'strict' },
                { label: 'Terlambat', value: `${target.daysLate} hari`, translate: true },
                { label: 'Sejak', value: formatDateTime(target.since) },
              ]}
            />
            <Select
              label="Status tindak lanjut"
              required
              value={form.status}
              options={STATUS_OPTIONS}
              onChange={(event) => setForm((f) => ({ ...f, status: event.target.value }))}
            />
            <Select
              label="Penanggung jawab tindak lanjut"
              value={form.ownerUserId}
              options={ownerOptions}
              dataOptions
              hint="Anda bisa menugaskan ke diri sendiri atau mengosongkannya; daftar pengguna lain tidak tersedia di halaman ini."
              onChange={(event) => setForm((f) => ({ ...f, ownerUserId: event.target.value }))}
            />
            <Textarea
              label="Catatan"
              value={form.note}
              maxLength={NOTE_MAX}
              error={formErrors.note}
              hint={`Apa yang sudah dilakukan dan langkah berikutnya · ${String(form.note || '').length}/${NOTE_MAX} karakter`}
              placeholder="Mis. sudah dibahas dengan Head divisi, target selesai Jumat."
              {...ai.field('note')}
              onChange={(event) => setForm((f) => ({ ...f, note: event.target.value }))}
            />
            <FormActions>
              <Button variant="text" type="button" onClick={closeFollowup} disabled={saving}>Batal</Button>
              <Button type="submit" loading={saving} disabled={Object.keys(formErrors).length > 0}>Simpan</Button>
            </FormActions>
          </form>
        ) : null}
      </Modal>
    </Page>
  );
}
