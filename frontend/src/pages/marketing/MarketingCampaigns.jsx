import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import Select from '../../components/Select';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import AnimatedNumber from '../../components/charts/AnimatedNumber';
import TrendChart from '../../components/charts/TrendChart';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import {
  CHANNELS, MAX_ITEMS, OBJECTIVE_LABELS, OBJECTIVE_OPTIONS, STATE_BADGE, STATE_LABELS, STATUS_LABELS, addItem, attentionText,
  campaignState, channelLabel, channelsText, detailItems, formBody, formErrors, formValues, isClosed, itemOptions, itemsFromAI,
  perfFigures, perfMessage, perfTrend, perfWindowText, periodText, stateChips, statusOptions, toggleChannel,
} from './marketingModel';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import './marketing.css';
import { Translate, dataAttributes, Context } from '../../i18n/NoTranslate';

const errorOf = (error) => error?.response?.data?.error || {};
const errorMessage = (error, fallback) => errorOf(error).message || fallback;
const todayWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const conflictText = 'Kampanye ini sudah diubah orang lain. Tutup, muat ulang, lalu ulangi perubahan Anda.';

// The product search of the campaign form (ItemPicker); Prakasa AI's lookup calls the same one.
const fetchItems = (q) => api.get('/marketing/items', { params: { q } }).then((r) => r.data.data || []);

// Prakasa AI may fill a campaign: name, objective, dates, channels, target
// products (through the form's own Accurate product search: exactly one match
// is added, anything else goes back to the user) and the note. Anggaran and
// status stay with the user, who presses "Simpan" (docs/prakasa-ai-rencana.md §9.9).
const campaignFields = ({ closed, searchItem, itemName }) => (closed ? [
  f.readOnly('name', 'Nama kampanye'),
  f.textarea('notes', 'Catatan / hasil kampanye', { maxLength: 1000 }),
] : [
  f.text('name', 'Nama kampanye', { required: true, maxLength: 150 }),
  f.select('objective', 'Tujuan', OBJECTIVE_OPTIONS, { required: true }),
  f.date('startOn', 'Tanggal mulai', { required: true }),
  f.date('endOn', 'Tanggal selesai', { required: true }),
  f.userOnly('budget', 'Anggaran (Rp)', 'number'),
  f.userOnly('status', 'Status', 'select'),
  f.checkbox('allChannels', 'Semua channel'),
  f.multiselect('channels', 'Channel', CHANNELS.map((c) => ({ value: c, label: channelLabel(c) })), { hint: 'Dipakai bila "Semua channel" tidak dicentang.' }),
  f.rows('items', 'Produk target', [
    f.lookup('itemNo', 'Produk Accurate', searchItem, { required: true, labelOf: itemName, hint: 'Nama atau kode produk di Accurate.' }),
  ], { maxRows: MAX_ITEMS, hint: 'Daftar kosong berarti semua produk.' }),
  f.textarea('notes', 'Catatan / hasil kampanye', { maxLength: 1000 }),
]);
const AI_CAMPAIGN = defineAIForm({
  id: 'marketing-campaign', title: 'Kampanye', permission: 'marketing.campaign.manage', submitLabel: 'Simpan', fields: campaignFields,
});
const AI_CAMPAIGN_EDIT = defineAIForm({
  id: 'marketing-campaign-edit', title: 'Ubah kampanye', permission: 'marketing.campaign.manage', submitLabel: 'Simpan perubahan', mode: 'edit', fields: campaignFields,
});

function CampaignBadge({ row }) {
  const state = campaignState(row);
  return <StatusBadge status={STATE_BADGE[state]} label={STATE_LABELS[state]} />;
}

const COLUMNS = [
  { key: 'name', header: 'Kampanye' },
  { key: 'objective', header: 'Tujuan', translate: true, translateContext: 'campaign', render: (r) => OBJECTIVE_LABELS[r.objective], sortValue: (r) => OBJECTIVE_LABELS[r.objective], exportValue: (r) => OBJECTIVE_LABELS[r.objective] },
  { key: 'channels', header: 'Channel', render: (r) => (r.channels === 'all' ? <Translate>{channelsText(r.channels)}</Translate> : channelsText(r.channels)), sortValue: (r) => channelsText(r.channels), exportValue: (r) => channelsText(r.channels) },
  { key: 'startOn', header: 'Periode', nowrap: true, render: (r) => periodText(r), sortValue: (r) => r.startOn, exportValue: (r) => `${r.startOn} s.d. ${r.endOn}` },
  { key: 'itemCount', header: 'Produk', type: 'number', translate: true, render: (r) => (r.itemCount ? formatNumber(r.itemCount) : 'Semua'), exportValue: (r) => r.itemCount || 'Semua' },
  { key: 'budget', header: 'Anggaran', type: 'money' },
  {
    key: 'state', header: 'Status', nowrap: true,
    render: (r) => <CampaignBadge row={r} />,
    sortValue: (r) => STATE_LABELS[campaignState(r)],
    exportValue: (r) => STATE_LABELS[campaignState(r)],
  },
];

// ------------------------------------------------------------ performance in the side sheet
function Performance({ perf }) {
  const message = perfMessage(perf);
  if (message) return <EmptyState compact icon="query_stats" title="Kinerja belum tersedia" description={message} />;
  const figures = perfFigures(perf);
  const trend = perfTrend(perf);
  return (
    <div className="pw-stack">
      <ul className="mkt__perf">
        {figures.map((f) => (
          <li key={f.key} className="mkt__perf-item">
            <span className="mkt__perf-label">{f.label}</span>
            <span className="mkt__perf-value">
              {f.value === null ? '—' : <AnimatedNumber value={f.value} unit={f.unit} compact={f.unit === 'rupiah'} />}
            </span>
            <span className="mkt__perf-note">{f.note}</span>
          </li>
        ))}
      </ul>
      <p className="pw-text-helper">{perfWindowText(perf)}</p>
      {trend ? (
        <div className="pw-stack pw-stack--sm">
          <span className="pw-overline">{`Omzet produk target, ${trend.step}: sebelum lalu selama kampanye`}</span>
          <TrendChart months={trend.points} values={trend.values} unit="rupiah" label="Omzet produk target" height={120} />
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ target product picker
// `isAiItem(index)`: the product was added by Prakasa AI and not reviewed yet.
function ItemPicker({ items, onChange, disabled, error, isAiItem = () => false }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setFound([]); setSearchError(''); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await fetchItems(text);
        if (alive) { setFound(rows); setSearchError(''); }
      } catch (e) {
        if (alive) { setFound([]); setSearchError(errorMessage(e, 'Pencarian produk gagal.')); }
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  const chosen = new Set(items.map((i) => i.itemNo));
  const options = found.filter((f) => !chosen.has(f.itemNo));
  return (
    <div className="pw-stack">
      <Input
        label="Cari produk Accurate"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        hint={searchError || (searching ? 'Mencari produk' : 'Ketik minimal 2 huruf nama atau kode produk. Kosongkan daftar untuk semua produk.')}
        error={error}
      />
      {options.length ? (
        <div className="mkt__chips" aria-label="Hasil pencarian produk">
          {options.map((f) => (
            <Chip key={f.itemNo} data {...dataAttributes} icon="add" tooltip={f.itemNo} onClick={() => onChange(addItem(items, f))}>{f.itemName}</Chip>
          ))}
        </div>
      ) : null}
      <div className="pw-stack pw-stack--sm">
        <span className="pw-overline">{items.length ? `${formatNumber(items.length)} produk target` : 'Semua produk'}</span>
        {items.length ? (
          <div className={`mkt__chips${items.some((item, index) => isAiItem(index)) ? ' is-ai-row' : ''}`} aria-label="Produk target">
            {items.map((i, index) => (
              <Chip
                key={i.itemNo}
                icon={isAiItem(index) ? 'auto_awesome' : undefined}
                data
                data-no-translate={disabled ? 'attr' : undefined}
                selected
                trailingIcon={disabled ? undefined : 'close'}
                tooltip={disabled ? i.itemNo : `Hapus ${i.itemName}`}
                disabled={disabled}
                onClick={() => onChange(items.filter((x) => x.itemNo !== i.itemNo))}
              >
                {i.itemName}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ add / edit (FullScreenDialog, §3.3)
function CampaignFormDialog({ open, row, onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(row);
  const closed = isClosed(row);
  const [values, setValues] = useState(() => formValues(row, todayWib()));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(formValues(row, todayWib())); setErrors({}); setFormError(''); setDirty(false);
  }, [open, row]);

  const change = (next, field) => {
    setValues(next);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDirty(true);
  };
  const set = (field) => (e) => change({ ...values, [field]: e.target.value }, field);

  // What the form opened with: a value still equal to it was not typed by the user.
  const opened = useMemo(() => formValues(row, todayWib()), [row]);
  const foundItems = useRef(new Map());
  const searchItem = useCallback(async (text) => {
    const rows = await fetchItems(text);
    rows.forEach((item) => foundItems.current.set(item.itemNo, item.itemName));
    return itemOptions(rows);
  }, []);
  const ai = usePrakasaAIForm(editing ? AI_CAMPAIGN_EDIT : AI_CAMPAIGN, {
    enabled: open,
    record: { type: 'marketing_campaign', id: row?.id },
    values,
    apply: (patch) => {
      setValues((current) => ({
        ...current, ...patch,
        ...(patch.items ? { items: itemsFromAI(patch.items, (itemNo) => foundItems.current.get(itemNo)) } : {}),
      }));
      setDirty(true);
    },
    setErrors,
    validate: (next) => formErrors(next, row),
    initialValues: opened,
    context: {
      closed, searchItem,
      itemName: (itemNo) => values.items.find((item) => item.itemNo === itemNo)?.itemName || foundItems.current.get(itemNo) || '',
    },
  });

  const submit = async (event) => {
    event.preventDefault();
    const found = formErrors(values, row);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = formBody(values, row);
    if (editing && !Object.keys(body).filter((k) => k !== 'version').length) { onClose(); return; }
    setSaving(true); setFormError('');
    try {
      const response = editing ? await api.patch(`/marketing/campaigns/${row.id}`, body) : await api.post('/marketing/campaigns', body);
      toast(editing ? 'Kampanye diperbarui' : 'Kampanye ditambahkan', 'success');
      await onSaved?.(response.data.data || {});
    } catch (error) {
      const { code, message, details } = errorOf(error);
      if (code === 'VERSION_CONFLICT') setFormError(conflictText);
      else if (details?.field) setErrors((current) => ({ ...current, [details.field]: message }));
      else if (details?.fieldErrors && Object.keys(details.fieldErrors).length) {
        setErrors((current) => ({ ...current, ...Object.fromEntries(Object.entries(details.fieldErrors).map(([k, v]) => [k, v[0]])) }));
      } else setFormError(message || 'Kampanye gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={editing ? `Ubah ${row.name}` : 'Tambah kampanye'}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        {closed ? <Banner tone="info">{`Kampanye sudah ${STATUS_LABELS[row.status].toLowerCase()}. Hanya catatan hasil yang masih bisa diubah.`}</Banner> : null}
        <FullScreenSection title="Kampanye">
          <div className="pw-fsdialog__fields">
            <Input label="Nama kampanye" required maxLength={150} value={values.name} {...ai.field('name')} error={errors.name} disabled={closed} onChange={set('name')} />
            <Context name="campaign"><Select label="Tujuan" required placeholder="Pilih" options={OBJECTIVE_OPTIONS} value={values.objective} {...ai.field('objective')} error={errors.objective} disabled={closed} onChange={set('objective')} /></Context>
            <DateInput label="Tanggal mulai" required value={values.startOn} {...ai.field('startOn')} error={errors.startOn} disabled={closed} onChange={set('startOn')} />
            <DateInput label="Tanggal selesai" required value={values.endOn} {...ai.field('endOn')} error={errors.endOn} disabled={closed} onChange={set('endOn')} />
            <Input label="Anggaran (Rp)" type="number" inputMode="decimal" min={0} value={values.budget} error={errors.budget} disabled={closed} onChange={set('budget')} hint="Boleh dikosongkan" />
            <Select label="Status" required options={statusOptions(row)} value={values.status} error={errors.status} disabled={closed} onChange={set('status')} />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Channel">
          <div className="pw-stack pw-stack--sm">
            <div className={`mkt__chips${ai.isFilled('channels') || ai.isFilled('allChannels') ? ' is-ai-row' : ''}`} role="group" aria-label="Channel kampanye">
              <Chip selected={values.allChannels} disabled={closed} onClick={() => change(toggleChannel(values, 'all'), 'channels')}>Semua channel</Chip>
              {CHANNELS.map((c) => (
                <Chip key={c} data={c !== 'Export'} selected={!values.allChannels && values.channels.includes(c)} disabled={closed} onClick={() => change(toggleChannel(values, c), 'channels')}>
                  {channelLabel(c)}
                </Chip>
              ))}
            </div>
            {errors.channels ? <span className="mkt__error" role="alert">{errors.channels}</span> : null}
          </div>
        </FullScreenSection>
        <FullScreenSection title="Produk target">
          <ItemPicker items={values.items} disabled={closed} error={errors.items} isAiItem={(index) => ai.isRowFilled('items', index)} onChange={(items) => change({ ...values, items }, 'items')} />
        </FullScreenSection>
        <FullScreenSection title="Catatan">
          <Textarea label="Catatan / hasil kampanye" rows={4} maxLength={1000} value={values.notes} {...ai.field('notes')} error={errors.notes} onChange={set('notes')} hint="Misalnya: mekanisme promo, materi, atau hasil akhir kampanye" />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

// ------------------------------------------------------------ close (done or cancelled) with the result
function CloseDialog({ open, row, onClose, onSaved }) {
  const formId = useId();
  const [status, setStatus] = useState('selesai');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !row) return;
    setStatus(row.status === 'draft' ? 'dibatalkan' : 'selesai'); setNotes(row.notes || ''); setError('');
  }, [open, row]);
  if (!row) return null;
  const options = statusOptions(row).filter((o) => o.value === 'selesai' || o.value === 'dibatalkan');
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { version: row.version, status };
      if ((notes.trim() || null) !== (row.notes || null)) body.notes = notes.trim() || null;
      await api.patch(`/marketing/campaigns/${row.id}`, body);
      toast(status === 'selesai' ? 'Kampanye ditandai selesai' : 'Kampanye dibatalkan', 'success');
      await onSaved?.();
    } catch (e) {
      const { code, message } = errorOf(e);
      setError(code === 'VERSION_CONFLICT' ? conflictText : (message || 'Kampanye gagal ditutup.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={`Tutup ${row.name}`}
      size="md"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Select label="Status akhir" required options={options} value={status} onChange={(e) => setStatus(e.target.value)} />
        <Textarea label="Hasil kampanye" rows={4} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} hint="Apa yang berhasil, apa yang tidak, dan saran untuk kampanye berikutnya" />
      </form>
    </Modal>
  );
}

// Marketing → Kampanye (migration 119): the campaign tracker. A row opens a
// side sheet with its facts and its live performance (target products in its
// channels against the same number of days before). Marketing Supervisor/Head
// add and change campaigns (marketing.campaign.manage). No delete: a campaign
// ends Selesai or Dibatalkan.
export default function MarketingCampaigns() {
  const { user } = useAuth();
  const canManage = (user?.permissions || []).includes('marketing.campaign.manage');
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('open')) || null;

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [detail, setDetail] = useState({ row: null, loading: false, error: '' });
  const [form, setForm] = useState(null); // { row }
  const [closing, setClosing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await api.get('/marketing/campaigns');
      setRows(r.data.data || []);
      setSummary(r.data.meta?.summary || null);
    } catch (error) {
      setRows([]);
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail({ row: null, loading: false, error: '' }); return; }
    setDetail((d) => ({ row: d.row?.id === id ? d.row : null, loading: true, error: '' }));
    try {
      const r = await api.get(`/marketing/campaigns/${id}`);
      setDetail({ row: r.data.data, loading: false, error: '' });
    } catch (error) {
      setDetail({ row: null, loading: false, error: errorMessage(error, 'Kampanye gagal dimuat.') });
    }
  }, []);
  useEffect(() => { loadDetail(openId); }, [openId, loadDetail]);

  // The form opens by URL too (a link, or Prakasa AI's buka_halaman):
  // ?baru=1 adds a campaign, ?ubah=<id> changes one of the listed campaigns.
  useOpenFromUrl('baru', () => { if (canManage) setForm({ row: null }); }, { keepUnsaved: true });
  useOpenFromUrl('ubah', (id) => {
    const found = rows.find((r) => String(r.id) === String(id));
    if (canManage && found) setForm({ row: found });
  }, { enabled: !loading, keepUnsaved: true });

  const setOpen = (id) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (id) next.set('open', String(id)); else next.delete('open');
    return next;
  }, { replace: true });

  const afterSave = async () => {
    setForm(null); setClosing(null);
    await load();
    if (openId) await loadDetail(openId);
  };

  const listed = openId ? rows.find((r) => r.id === openId) || null : null;
  const selected = detail.row && detail.row.id === openId ? detail.row : listed;
  const canClose = (r) => canManage && (r.status === 'berjalan' || r.status === 'draft');
  const rowActions = canManage ? (r) => (
    <>
      {canClose(r) ? <IconButton size="sm" icon="flag" label={`Tutup ${r.name}`} onClick={() => setClosing(r)} /> : null}
      <IconButton size="sm" icon="edit" label={`Ubah ${r.name}`} onClick={() => setForm({ row: r })} />
    </>
  ) : undefined;

  const chips = stateChips(rows);
  const visible = stateFilter ? rows.filter((r) => campaignState(r) === stateFilter) : rows;
  const filterBar = (
    <>
      <Chip selected={!stateFilter} onClick={() => setStateFilter('')}>{`Semua (${formatNumber(rows.length)})`}</Chip>
      {chips.map((c) => (
        <Chip key={c.key} selected={stateFilter === c.key} onClick={() => setStateFilter(stateFilter === c.key ? '' : c.key)}>
          {`${c.label} (${formatNumber(c.count)})`}
        </Chip>
      ))}
    </>
  );
  const attention = attentionText(summary);
  const sheetFooter = selected && canManage ? (
    <div className="mkt__sheet-actions">
      {canClose(selected) ? <Button variant="secondary" icon="flag" onClick={() => setClosing(selected)}>Tutup kampanye</Button> : null}
      <Button variant="text" icon="edit" onClick={() => setForm({ row: selected })}>Ubah</Button>
    </div>
  ) : null;

  return (
    <Page
      title="Kampanye"
      description="Kampanye Marketing per channel dan produk, dengan hasilnya dihitung langsung dari data Accurate: omzet produk target selama kampanye dibanding periode yang sama panjang sebelumnya."
      actions={canManage ? <Button icon="add" onClick={() => setForm({ row: null })}>Tambah kampanye</Button> : null}
    >
      {attention ? <Banner tone="warning" title="Perlu ditutup">{attention}</Banner> : null}
      {!loading && !loadError && !rows.length ? (
        <EmptyState
          icon="campaign"
          title="Belum ada kampanye"
          description={canManage
            ? 'Catat kampanye promo, peluncuran produk, atau reaktivasi pelanggan dengan tombol Tambah kampanye. Hasilnya dihitung otomatis dari faktur Accurate.'
            : 'Kampanye promo, peluncuran produk, atau reaktivasi pelanggan akan muncul di sini. Hasilnya dihitung otomatis dari faktur Accurate.'}
        />
      ) : (
        <DataGrid
          title="Daftar kampanye"
          showTitle={false}
          rows={visible}
          loading={loading}
          error={loadError}
          onRetry={load}
          exportName="kampanye-marketing"
          searchPlaceholder="Cari nama kampanye atau channel"
          filters={rows.length ? filterBar : undefined}
          empty="Tidak ada kampanye yang cocok dengan filter ini"
          onRowClick={(r) => setOpen(r.id)}
          rowActions={rowActions}
          columns={COLUMNS}
        />
      )}

      <SideSheet open={Boolean(openId)} onClose={() => setOpen(null)} title={selected?.name || 'Kampanye'} dataTitle={Boolean(selected?.name)} footer={sheetFooter}>
        {selected ? (
          <div className="pw-stack pw-stack--lg">
            <CampaignBadge row={selected} />
            <KeyValue items={detailItems(selected)} />
            <section className="pw-stack" aria-label="Kinerja kampanye">
              <h3 className="pw-title-section">Kinerja</h3>
              {detail.loading && !detail.row?.performance ? <LoadingState compact label="Menghitung kinerja" /> : null}
              {detail.error ? <EmptyState compact tone="error" title="Kinerja gagal dimuat" description={detail.error} action={<Button variant="text" onClick={() => loadDetail(openId)}>Coba lagi</Button>} /> : null}
              {detail.row?.performance ? <Performance perf={detail.row.performance} /> : null}
            </section>
          </div>
        ) : null}
        {!selected && detail.loading ? <LoadingState label="Memuat kampanye" /> : null}
        {!selected && !detail.loading && detail.error ? <EmptyState tone="error" title="Kampanye tidak bisa dibuka" description={detail.error} /> : null}
      </SideSheet>

      <CampaignFormDialog open={Boolean(form)} row={form?.row || null} onClose={() => setForm(null)} onSaved={afterSave} />
      <CloseDialog open={Boolean(closing)} row={closing} onClose={() => setClosing(null)} onSaved={afterSave} />
    </Page>
  );
}
