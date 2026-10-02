import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useRealtime } from '../../api/realtime';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormActions from '../../components/FormActions';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import ProgressBar from '../../components/ProgressBar';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import DataGrid from '../../components/datagrid/DataGrid';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { apiErrorMessage, debounce, unwrap } from '../projects/trackerModel';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  actualText, buildMatrix, findTargetCell, moduleOptions, pickModule, convertPeriod, currentPeriodKey, isWholeUnit, metricRule, NO_DATA_TEXT,
  normalizeTargets, NOTE_MAX, paceText, PERIOD_TYPE_OPTIONS, periodLabel, periodOptions,
  periodProgressText, periodType, readTargetParams, restrictedNotes, shortPaceText, STATUS_LABELS, statusRank,
  SUMMARY_STATUSES, targetForm, targetHint, targetPayload, targetQuery, targetRecordId, targetText, unitLabel, validateNote,
  validateTargetInput, writeTargetParams,
} from './targetsModel';
import './targets.css';

// Prakasa AI may write the note behind a target. The target number is a
// management decision (and often rupiah): the user's only.
const AI_TARGET = defineAIForm({
  id: 'management-target',
  title: 'Ubah target',
  permission: 'management_dashboard.view',
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: [
    f.textarea('note', 'Catatan', { maxLength: NOTE_MAX, hint: 'Alasan atau kesepakatan di balik target ini.' }),
    f.userOnly('value', 'Target', 'number'),
  ],
});

// One division × metric: realisation (never "0" for unknown), target, status —
// and, only for an editor, the pencil that opens the edit dialog.
function TargetCell({ cell, metric, division, canEdit, onEdit }) {
  const actual = actualText(cell, metric);
  const measure = shortPaceText(cell, metric);
  return (
    <div className="tgt-cell">
      <span className={actual === NO_DATA_TEXT ? 'tgt-cell__actual is-empty' : 'tgt-cell__actual'}>{actual}</span>
      <span className="tgt-cell__target">Target {targetText(cell, metric)}</span>
      {measure ? <span className="tgt-cell__measure">{measure}</span> : null}
      <span className="tgt-cell__foot">
        <StatusBadge status={cell.status} label={STATUS_LABELS[cell.status]} />
        {canEdit ? (
          // Short label on purpose (it is the tooltip); the full context goes to screen readers.
          <IconButton
            size="sm"
            label="Ubah target"
            aria-label={`Ubah target ${metric.label} — ${division.name}`}
            icon="edit"
            onClick={() => onEdit(division, metric, cell)}
          />
        ) : null}
      </span>
    </div>
  );
}

// Target & realisasi: management sets a target per division × metric × period and
// sees it next to the realisation the server computes live from each division
// module's own data. Metrics, units and their source module all come from the API
// (one management provider per module), so a new module needs no change here.
// Tracker events move the actuals, so they refetch (debounced).
export default function Targets() {
  const [params, setParams] = useSearchParams();
  const { period: urlPeriod, module: urlModule } = readTargetParams(params);

  const [state, setState] = useState({ loading: true, error: '', code: '', data: normalizeTargets(null) });
  const [editing, setEditing] = useState(null); // { division, metric, cell }
  const [form, setForm] = useState(targetForm(null));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    if (!silent) setState((s) => ({ ...s, loading: true, error: '', code: '' }));
    try {
      const data = unwrap(await api.get('/management-dashboard/targets', { params: targetQuery(urlPeriod) }));
      // A slower answer for a period the user already left must not overwrite the new one.
      if (request !== requestRef.current) return;
      setState({ loading: false, error: '', code: '', data: normalizeTargets(data) });
    } catch (error) {
      if (request !== requestRef.current) return;
      // A background refetch that fails keeps the last good matrix on screen.
      if (silent) return;
      setState((s) => ({
        ...s,
        loading: false,
        code: error?.response?.data?.error?.code || '',
        error: apiErrorMessage(error, 'Target & realisasi gagal dimuat.'),
      }));
    }
  }, [urlPeriod]);

  useEffect(() => { load(false); }, [load]);
  const refresh = useMemo(() => debounce(() => load(true), 1000), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useRealtime('tracker', () => refresh());

  const { data } = state;
  const { scope, period, canEdit } = data;
  const noDepartment = state.code === 'NO_DEPARTMENT';
  const modules = useMemo(() => moduleOptions(data), [data]);
  const module = pickModule(modules, urlModule);
  const matrix = useMemo(() => buildMatrix(data, module), [data, module]);
  // Metrics this account may not see (purchase prices): named, never a number.
  const hiddenNotes = useMemo(() => restrictedNotes(data, module), [data, module]);

  // What the picker shows: the URL's period, else what the server answered with,
  // else the server's default (the current quarter) while the first answer loads.
  const today = useMemo(() => new Date(), []);
  const selectedKey = urlPeriod || period.key || currentPeriodKey('quarter', today);
  const selectedType = periodType(selectedKey);
  const options = useMemo(() => periodOptions(today, selectedKey), [today, selectedKey]);
  const periodShown = period.key === selectedKey;

  const choosePeriod = (key) => setParams(writeTargetParams(params, { period: key }), { replace: true });
  const chooseModule = (value) => setParams(writeTargetParams(params, { module: value }), { replace: true });

  const openEdit = (division, metric, cell) => {
    setEditing({ division, metric, cell });
    setForm(targetForm(cell));
    setTouched(false);
  };
  const closeEdit = () => { if (!saving) setEditing(null); };
  // /targets?ubah=<id divisi>-<kunci metrik> opens that cell's dialog, for whoever may edit.
  useOpenFromUrl('ubah', (recordId) => {
    const found = canEdit ? findTargetCell(data, recordId) : null;
    if (found) openEdit(found.division, found.metric, found.cell);
  }, { enabled: !state.loading && !state.error, keepUnsaved: true });
  const ai = usePrakasaAIForm(AI_TARGET, {
    enabled: Boolean(editing),
    record: { type: 'division_target', id: targetRecordId(editing?.division.id, editing?.metric.key) },
    values: form,
    setValues: setForm,
    initialValues: targetForm(editing?.cell),
    validate: (next) => ({ note: validateNote(next.note) }),
  });

  const valueCheck = editing ? validateTargetInput(form.value, editing.metric) : { value: null, error: '' };
  const noteError = validateNote(form.note);
  const valueError = touched || form.value !== '' ? valueCheck.error : '';

  const put = async (value, note, successMessage) => {
    setSaving(true);
    try {
      await api.put('/management-dashboard/targets', targetPayload({
        departmentId: editing.division.id,
        metricKey: editing.metric.key,
        period: period.key,
        value,
        note,
      }));
      setEditing(null);
      setConfirmClear(false);
      toast(successMessage, 'success');
      // Achievement and status are decided by the server — ask it again.
      load(true);
    } catch (error) {
      toast(apiErrorMessage(error, 'Target gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveTarget = (event) => {
    event.preventDefault();
    setTouched(true);
    if (!editing || valueCheck.error || noteError) return;
    put(valueCheck.value, form.note, 'Target tersimpan');
  };

  const clearTarget = () => put(null, null, 'Target dihapus');

  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'Divisi',
      translate: true,
      sortValue: (row) => row.name,
      exportValue: (row) => row.name,
      render: (row) => <span className="tgt-division">{row.name}</span>,
    },
    ...matrix.metrics.map((metric) => ({
      key: metric.key,
      header: metric.label,
      translate: true,
      searchable: false,
      // Worst first when sorted ascending.
      sortValue: (row) => statusRank(row.cells[metric.key].status),
      exportValue: (row) => {
        const cell = row.cells[metric.key];
        return `${actualText(cell, metric)} / target ${targetText(cell, metric)} (${STATUS_LABELS[cell.status]})`;
      },
      render: (row) => (
        <TargetCell
          cell={row.cells[metric.key]}
          metric={metric}
          division={row}
          canEdit={canEdit}
          onEdit={openEdit}
        />
      ),
    })),
  ], [matrix.metrics, canEdit]);

  const { summary } = matrix;
  const ready = !state.loading && !noDepartment && !state.error;
  const editingMetric = editing?.metric;

  const moduleChips = modules.length > 1 ? modules.map((option) => (
    <Chip key={option.value} selected={module === option.value} onClick={() => chooseModule(option.value)}>
      {option.offTrack ? `${option.label} (${option.offTrack} tertinggal)` : option.label}
    </Chip>
  )) : undefined;

  return (
    <Page
      title="Target & realisasi"
      description="Target per divisi dan per metrik untuk satu periode, berdampingan dengan realisasi yang dihitung langsung dari data setiap modul divisi."
      actions={(
        <Button variant="secondary" type="button" icon="refresh" onClick={() => load(false)} loading={state.loading}>
          Muat ulang
        </Button>
      )}
    >
      {noDepartment ? (
        // An account-setup problem, not a transient failure: retrying never helps.
        <EmptyState
          icon="domain"
          title="Akun Anda belum terhubung ke divisi"
          description="Target & realisasi ditampilkan per divisi, jadi akun Anda perlu terdaftar pada salah satu divisi. Hubungi admin untuk menautkannya."
        />
      ) : null}

      {!noDepartment && state.error ? (
        <EmptyState
          tone="error"
          title="Target & realisasi gagal dimuat"
          description={state.error}
          action={<Button variant="secondary" type="button" onClick={() => load(false)}>Coba lagi</Button>}
        />
      ) : null}

      {ready && !scope.entityWide ? (
        <Banner tone="info">
          {scope.departmentName ? `Hanya divisi ${scope.departmentName}` : 'Tampilan dibatasi pada divisi Anda.'}
        </Banner>
      ) : null}

      {!noDepartment ? (
        <Card title="Periode">
          <div className="tgt-period">
            <div className="tgt-period__controls">
              <Select
                label="Jenis periode"
                value={selectedType}
                options={PERIOD_TYPE_OPTIONS}
                onChange={(event) => choosePeriod(convertPeriod(selectedKey, event.target.value, today))}
              />
              <Select
                label={selectedType === 'month' ? 'Bulan' : 'Kuartal'}
                value={selectedKey}
                options={options[selectedType]}
                onChange={(event) => choosePeriod(event.target.value)}
              />
            </div>
            <div className="tgt-period__status">
              <span className="tgt-period__label">{periodShown ? period.label : periodLabel(selectedKey)}</span>
              {periodShown ? (
                <>
                  <span className="pw-text-helper">{periodProgressText(period, today)}</span>
                  <ProgressBar value={period.elapsedPct} max={100} label={periodProgressText(period, today)} />
                </>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {state.loading ? <LoadingState label="Memuat target & realisasi…" /> : null}

      {ready ? (
        <>
          <div className="pw-stack pw-stack--sm">
            <div className="pw-cols-4 tgt-kpis">
              {SUMMARY_STATUSES.map((status) => {
                const alert = status === 'off_track' && summary[status] > 0;
                return (
                  <StatCard
                    key={status}
                    label={STATUS_LABELS[status]}
                    value={summary[status]}
                    alert={alert}
                    note={alert ? 'Perlu ditindaklanjuti' : null}
                  />
                );
              })}
            </div>
            <p className="pw-text-helper tgt-note">
              {summary.withTarget
                ? `${summary.withTarget} dari ${summary.total} sel punya target pada periode ini.`
                : 'Belum ada target yang ditetapkan untuk periode ini.'}
              {summary.no_data ? ` ${summary.no_data} target belum punya data realisasi (bukan nol).` : ''}
              {summary.billed_monthly ? ` ${summary.billed_monthly} target ditagih bulanan, dinilai setelah periode selesai.` : ''}
            </p>
          </div>

          <div className="pw-stack pw-stack--sm">
            <DataGrid
              title="Matriks target"
              columns={columns}
              rows={matrix.rows}
              idKey="id"
              filters={moduleChips}
              searchable={matrix.rows.length > 8}
              exportName={`target-realisasi-${period.key || 'periode'}`}
              pageSize={50}
              empty={(
                <EmptyState
                  icon="track_changes"
                  title="Belum ada divisi"
                  description="Belum ada divisi yang bisa diberi target pada entitas ini."
                  compact
                />
              )}
            />
            <p className="pw-text-helper tgt-note">
              {canEdit
                ? 'Pilih ikon pensil pada sel untuk menetapkan atau mengubah target. Realisasi dan status dihitung otomatis oleh sistem.'
                : 'Target ditetapkan oleh manajemen. Anda dapat melihat target dan realisasinya, tetapi tidak mengubahnya.'}
            </p>
            {hiddenNotes.map((note) => <p key={note} className="pw-text-helper tgt-note">{note}</p>)}
          </div>

          {matrix.metrics.length ? (
            <Card title="Cara membaca">
              <div className="pw-stack">
                <ul className="tgt-legend">
                  {matrix.metrics.map((metric) => (
                    <li key={metric.key} className="pw-cell">
                      <span className="tgt-legend__name">{metric.label}</span>
                      <span className="pw-text-helper">
                        {/* Three whole strings, so each has its own translation. */}
                        {`Satuan: ${unitLabel(metric.unit)}`}
                        {metric.source ? ` · Sumber: ${metric.source}` : ''}
                        {'. '}
                        {metricRule(metric)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="pw-text-helper tgt-note">
                  Laju membandingkan realisasi dengan bagian target yang seharusnya sudah tercapai saat ini
                  (sebanding dengan berjalannya periode). Setelah periode selesai, yang dinilai adalah capaian akhirnya.
                  &ldquo;{NO_DATA_TEXT}&rdquo; berarti realisasinya belum bisa dihitung — bukan nol.
                </p>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <Modal open={Boolean(editing)} onClose={closeEdit} title="Ubah target" size="sm">
        {editing ? (
          <form className="pw-stack" onSubmit={saveTarget} noValidate>
            {ai.notice}
            <KeyValue
              items={[
                { label: 'Divisi', value: editing.division.name, translate: true },
                { label: 'Metrik', value: `${editingMetric.label} (${unitLabel(editingMetric.unit)})`, translate: true },
                { label: 'Periode', value: period.label, translate: true },
                { label: 'Realisasi', value: actualText(editing.cell, editingMetric), translate: true },
                { label: 'Status', value: <StatusBadge status={editing.cell.status} label={STATUS_LABELS[editing.cell.status]} /> },
              ]}
            />
            <p className="pw-text-helper tgt-note">{paceText(editing.cell, editingMetric, period)}</p>
            {editingMetric.better === 'lower' ? (
              <Banner tone="info">
                Lebih rendah lebih baik — target adalah batas atas. Realisasi di bawah atau sama dengan target dianggap tercapai.
              </Banner>
            ) : null}
            <Input
              label={`Target (${unitLabel(editingMetric.unit)})`}
              type="number"
              inputMode="decimal"
              min={0}
              max={editingMetric.unit === '%' ? 100 : undefined}
              step={isWholeUnit(editingMetric.unit) ? 1 : 'any'}
              required
              value={form.value}
              error={valueError}
              hint={targetHint(editingMetric)}
              onChange={(event) => setForm((f) => ({ ...f, value: event.target.value }))}
              onBlur={() => setTouched(true)}
            />
            <Textarea
              label="Catatan"
              value={form.note}
              maxLength={NOTE_MAX}
              error={noteError}
              hint={`Alasan atau kesepakatan di balik target ini · ${String(form.note || '').length}/${NOTE_MAX} karakter`}
              placeholder="Mis. disepakati di rapat kuartal, fokus pada backlog lama."
              {...ai.field('note')}
              onChange={(event) => setForm((f) => ({ ...f, note: event.target.value }))}
            />
            {editing.cell.updatedAt ? (
              <p className="pw-text-meta tgt-note">
                Terakhir diubah {formatDateTime(editing.cell.updatedAt)}
                {editing.cell.updatedByName ? ` oleh ${editing.cell.updatedByName}` : ''}.
              </p>
            ) : null}
            <FormActions>
              {editing.cell.target !== null ? (
                <Button variant="danger" type="button" className="tgt-clear" onClick={() => setConfirmClear(true)} disabled={saving}>
                  Hapus target
                </Button>
              ) : null}
              <Button variant="text" type="button" onClick={closeEdit} disabled={saving}>Batal</Button>
              <Button type="submit" loading={saving && !confirmClear} disabled={Boolean(noteError) || (touched && Boolean(valueCheck.error))}>
                Simpan
              </Button>
            </FormActions>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmClear && Boolean(editing)}
        title="Hapus target?"
        message={editing
          ? `Target "${editing.metric.label}" untuk ${editing.division.name} pada ${period.label} akan dihapus. Realisasinya tetap dihitung, hanya targetnya yang dikosongkan.`
          : ''}
        confirmLabel="Hapus target"
        tone="danger"
        loading={saving}
        onConfirm={clearTarget}
        onClose={() => { if (!saving) setConfirmClear(false); }}
      />
    </Page>
  );
}
