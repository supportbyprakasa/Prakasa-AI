import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { NoTranslate } from '../../i18n/NoTranslate';
import { AddTemplateDialog, EditTemplateDialog, GenerateDialog, KopDialog } from './DocTemplateDialogs';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { LAYOUTS, STANDARD_FIELDS, TABS, generateFields, kopStatus, scopeKey, tabFrom } from './docTemplateModel';
import './doc-templates.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;
const layoutLabel = (value) => LAYOUTS.find((l) => l.value === value)?.label || '';

// Template dokumen (migration 115): templates as Google Docs with
// {{placeholders}}, a kop & footer per division, and the documents made from
// them — each a Google Doc in its division's Shared Drive folder. BAST for
// devices and company numbers are made from the device or number itself.
export default function DocTemplates() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('template.manage');
  const canCreate = permissions.includes('document.create');
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get('tab'));
  const openId = Number(params.get('open')) || null;

  const [templates, setTemplates] = useState({ templates: [], missingBuiltins: [] });
  const [kops, setKops] = useState({ companyName: '', scopes: [] });
  const [generated, setGenerated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [generateFor, setGenerateFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [kopFor, setKopFor] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);

  const loadKops = useCallback(async () => {
    try {
      const r = await api.get('/doc-templates/kops');
      setKops(r.data.data || { companyName: '', scopes: [] });
    } catch { setKops({ companyName: '', scopes: [] }); }
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      if (tab === 'templates') setTemplates((await api.get('/doc-templates')).data.data || { templates: [], missingBuiltins: [] });
      if (tab === 'kop') await loadKops();
      if (tab === 'generated') setGenerated((await api.get('/doc-templates/generated')).data.data || []);
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [tab, loadKops]);
  useEffect(() => { load(); }, [load]);
  // The add dialog needs the scopes this user manages.
  useEffect(() => { if (canManage) loadKops(); }, [canManage, loadKops]);
  // Dialogs a link (or Prakasa AI) may open: ?baru=1 "Tambah template",
  // ?ubah=<id template> its settings, ?tab=kop&form=<id divisi | company> a kop.
  // Only what this user is offered on the page itself.
  // Four dialogs, one at a time: an unsaved one is never replaced or covered by a link (keepUnsaved).
  useOpenFromUrl('baru', () => setAddOpen(true), { enabled: canManage && kops.scopes.length > 0, keepUnsaved: true });
  useOpenFromUrl('ubah', (value) => {
    const found = templates.templates.find((t) => String(t.id) === String(value));
    if (found?.canManage) setEditFor(found);
  }, { enabled: tab === 'templates' && !loading, keepUnsaved: true });
  // ?buat=<id template>: "Buat dokumen" from that template.
  useOpenFromUrl('buat', (value) => {
    const found = templates.templates.find((t) => String(t.id) === String(value));
    if (found && canCreate && found.isActive && !found.subjectType) setGenerateFor(found);
  }, { enabled: tab === 'templates' && !loading, keepUnsaved: true });
  useOpenFromUrl('form', (value) => {
    const found = kops.scopes.find((r) => scopeKey(r.departmentId) === String(value));
    if (found?.canManage) setKopFor(found);
  }, { enabled: canManage && kops.scopes.length > 0, keepUnsaved: true });

  const setParam = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return next;
  }, { replace: true });

  const prepare = async () => {
    setPreparing(true);
    try {
      const r = await api.post('/doc-templates/prepare-builtins', {});
      toast(`${formatNumber(r.data.data.made.length)} template BAST disiapkan di Shared Drive`, 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Template BAST gagal disiapkan'), 'error');
    } finally {
      setPreparing(false);
    }
  };
  const check = async (t) => {
    setChecking(true);
    try {
      const r = await api.post(`/doc-templates/${t.id}/check`, {});
      toast(`Isian diperbarui: ${formatNumber(generateFields(r.data.data).length)} isian`, 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Template gagal diperiksa'), 'error');
    } finally {
      setChecking(false);
    }
  };

  const list = templates.templates;
  const selected = tab === 'templates' && openId ? list.find((t) => t.id === openId) || null : null;
  const visible = mineOnly ? list.filter((t) => t.departmentId === user?.departmentId) : list;
  const templateColumns = [
    {
      key: 'name', header: 'Template',
      render: (t) => (
        <span className="pw-cell">
          <span>{t.name}</span>
          {t.description ? <span className="pw-cell__meta">{t.description}</span> : null}
        </span>
      ),
      exportValue: (t) => t.name,
    },
    { key: 'departmentName', header: 'Divisi', translate: true },
    { key: 'prefix', header: 'Awalan nomor', nowrap: true },
    { key: 'fields', header: 'Isian', type: 'number', render: (t) => formatNumber(generateFields(t).length), sortValue: (t) => generateFields(t).length, exportValue: (t) => generateFields(t).length },
    {
      key: 'isActive', header: 'Status', nowrap: true,
      render: (t) => <StatusBadge status={t.isActive ? 'active' : 'inactive'} label={t.isActive ? 'Dipakai' : 'Tidak dipakai'} />,
      sortValue: (t) => (t.isActive ? 0 : 1), exportValue: (t) => (t.isActive ? 'Dipakai' : 'Tidak dipakai'),
    },
  ];
  const templateActions = (t) => (
    <>
      {canCreate && t.isActive && !t.subjectType ? <IconButton size="sm" icon="note_add" label={`Buat dokumen dari ${t.name}`} onClick={() => setGenerateFor(t)} /> : null}
      {t.webViewLink ? <IconButton size="sm" icon="open_in_new" label={`Buka template ${t.name} di Google Docs`} href={t.webViewLink} target="_blank" rel="noreferrer" /> : null}
    </>
  );

  const kopColumns = [
    { key: 'departmentName', header: 'Divisi', translate: true },
    {
      key: 'status', header: 'Kop & footer', nowrap: true,
      render: (r) => <StatusBadge status={r.kop ? 'active' : 'draft'} label={kopStatus(r)} />,
      sortValue: kopStatus, exportValue: kopStatus,
    },
    { key: 'layout', header: 'Tata letak', translate: true, render: (r) => layoutLabel(r.kop?.layout), sortValue: (r) => layoutLabel(r.kop?.layout), exportValue: (r) => layoutLabel(r.kop?.layout) },
    { key: 'updatedByName', header: 'Diubah oleh', render: (r) => r.kop?.updatedByName || '', exportValue: (r) => r.kop?.updatedByName || '' },
    { key: 'updatedAt', header: 'Diubah', render: (r) => (r.kop ? formatDateTime(r.kop.updatedAt) : ''), sortValue: (r) => r.kop?.updatedAt || '', exportValue: (r) => r.kop?.updatedAt || '' },
  ];
  const kopActions = (r) => (
    <>
      {r.canManage ? <IconButton size="sm" icon="edit" label={`Atur kop ${r.departmentName}`} onClick={() => setKopFor(r)} /> : null}
      {r.kop?.webViewLink ? <IconButton size="sm" icon="open_in_new" label={`Buka kop ${r.departmentName} di Google Docs`} href={r.kop.webViewLink} target="_blank" rel="noreferrer" /> : null}
    </>
  );

  const generatedColumns = [
    { key: 'number', header: 'Nomor', nowrap: true },
    { key: 'title', header: 'Judul' },
    { key: 'templateName', header: 'Template' },
    { key: 'departmentName', header: 'Divisi', translate: true },
    { key: 'createdByName', header: 'Dibuat oleh' },
    { key: 'createdAt', header: 'Dibuat', type: 'datetime' },
  ];

  const missing = templates.missingBuiltins || [];
  let body;
  if (tab === 'templates') {
    body = (
      <>
        {canManage && missing.length ? (
          <Banner
            tone="info"
            title="Template BAST belum disiapkan"
            action={<Button variant="text" loading={preparing} onClick={prepare}>Siapkan template BAST</Button>}
          >
            {`${missing.map((m) => m.name).join(', ')} — dibuat sekali sebagai Google Docs di Shared Drive, lalu bisa diubah kata-katanya.`}
          </Banner>
        ) : null}
        <DataGrid
          title="Template"
          showTitle={false}
          rows={visible}
          loading={loading}
          error={loadError}
          onRetry={load}
          searchPlaceholder="Cari template"
          filters={list.length ? (
            <>
              <Chip selected={!mineOnly} onClick={() => setMineOnly(false)}>{`Semua (${formatNumber(list.length)})`}</Chip>
              <Chip selected={mineOnly} onClick={() => setMineOnly(true)}>{`Divisi saya (${formatNumber(list.filter((t) => t.departmentId === user?.departmentId).length)})`}</Chip>
            </>
          ) : undefined}
          empty={list.length ? 'Tidak ada template yang cocok' : 'Belum ada template. Tambahkan template atau siapkan template BAST.'}
          onRowClick={(t) => setParam({ open: String(t.id) })}
          rowActions={templateActions}
          columns={templateColumns}
        />
      </>
    );
  } else if (tab === 'kop') {
    body = (
      <>
        <Banner tone="info">Setiap dokumen dari template memakai kop & footer divisinya. Divisi tanpa kop memakai kop seluruh perusahaan.</Banner>
        <DataGrid
          title="Kop & footer"
          showTitle={false}
          rows={kops.scopes}
          loading={loading}
          error={loadError}
          onRetry={load}
          searchable={false}
          empty="Belum ada divisi"
          onRowClick={(r) => (r.canManage ? setKopFor(r) : null)}
          rowActions={kopActions}
          columns={kopColumns}
        />
      </>
    );
  } else {
    body = (
      <DataGrid
        title="Dokumen dibuat"
        showTitle={false}
        rows={generated}
        loading={loading}
        error={loadError}
        onRetry={load}
        exportable
        exportName="dokumen-dari-template"
        searchPlaceholder="Cari nomor atau judul"
        empty="Belum ada dokumen yang dibuat dari template"
        rowActions={(d) => (d.webViewLink ? <IconButton size="sm" icon="open_in_new" label={`Buka ${d.number} di Google Docs`} href={d.webViewLink} target="_blank" rel="noreferrer" /> : null)}
        columns={generatedColumns}
      />
    );
  }

  return (
    <Page
      title="Template dokumen"
      description="Template Google Docs dengan kop & footer per divisi. Dokumen yang dibuat langsung tersimpan di folder Shared Drive divisinya."
      actions={canManage && tab === 'templates' ? <Button icon="add" onClick={() => setAddOpen(true)}>Tambah template</Button> : null}
    >
      <TabBar tabs={TABS} value={tab} onChange={(k) => setParam({ tab: k === 'templates' ? '' : k, open: '' })} label="Template dokumen" idPrefix="doc-tpl-tab" panelId="doc-tpl-panel" />
      <div id="doc-tpl-panel" role="tabpanel" aria-labelledby={`doc-tpl-tab-${tab}`} className="pw-stack pw-stack--lg">{body}</div>

      <SideSheet
        open={Boolean(selected)}
        onClose={() => setParam({ open: '' })}
        title={selected?.name || ''}
        dataTitle
        footer={selected ? (
          <div className="doc-tpl__sheet-actions">
            {canCreate && selected.isActive && !selected.subjectType ? <Button icon="note_add" onClick={() => setGenerateFor(selected)}>Buat dokumen</Button> : null}
            {selected.webViewLink ? <Button variant="secondary" icon="open_in_new" href={selected.webViewLink} target="_blank" rel="noreferrer">Ubah di Google Docs</Button> : null}
            <Button variant="text" icon="sync" loading={checking} onClick={() => check(selected)}>Periksa isian</Button>
            {selected.canManage ? <Button variant="text" icon="edit" onClick={() => setEditFor(selected)}>Ubah</Button> : null}
          </div>
        ) : null}
      >
        {selected ? (
          <div className="pw-stack">
            {selected.subjectType ? (
              <Banner tone="info">
                {selected.subjectType === 'device_assignment'
                  ? 'BAST perangkat dibuat dari halaman perangkat (IT → Perangkat → Riwayat pemakaian), supaya datanya terisi otomatis.'
                  : 'BAST nomor dibuat dari Infrastruktur IT → Nomor perusahaan, supaya datanya terisi otomatis.'}
              </Banner>
            ) : null}
            <KeyValue items={[
              { label: 'Divisi', translate: true, value: selected.departmentName },
              { label: 'Awalan nomor', translate: true, value: `${selected.prefix} (contoh ${selected.prefix}-202610-0001)` },
              { label: 'Keterangan', value: selected.description },
              { label: 'Isian diperiksa', value: formatDateTime(selected.checkedAt) },
            ]}
            />
            <section className="pw-stack pw-stack--sm" aria-label="Isian template">
              <h3 className="pw-title-section">Isian</h3>
              <div className="doc-tpl__fields">
                {selected.placeholders.map((p) => (
                  <span key={p.key} className={`doc-tpl__field${STANDARD_FIELDS.includes(p.key) ? ' is-auto' : ''}`}>
                    <NoTranslate>{`{{${p.key}}}`}</NoTranslate>
                    <span className="doc-tpl__field-label">{STANDARD_FIELDS.includes(p.key) ? `${p.label} · otomatis` : <NoTranslate>{p.label}</NoTranslate>}</span>
                  </span>
                ))}
              </div>
              <p className="pw-text-helper">Setelah mengubah template di Google Docs, pilih "Periksa isian" agar formulirnya mengikuti.</p>
            </section>
          </div>
        ) : null}
      </SideSheet>

      {canManage ? <AddTemplateDialog open={addOpen} scopes={kops.scopes} onClose={() => setAddOpen(false)} onSaved={async (t) => { setAddOpen(false); await load(); if (t?.id) setParam({ open: String(t.id) }); }} /> : null}
      <GenerateDialog open={Boolean(generateFor)} template={generateFor} onClose={() => setGenerateFor(null)} />
      <EditTemplateDialog open={Boolean(editFor)} template={editFor} onClose={() => setEditFor(null)} onSaved={async () => { setEditFor(null); await load(); }} />
      <KopDialog open={Boolean(kopFor)} row={kopFor} companyName={kops.companyName} onClose={() => setKopFor(null)} onSaved={async () => { setKopFor(null); await loadKops(); }} />
    </Page>
  );
}
