import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage as errorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Menu from '../../components/Menu';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import ProgressBar from '../../components/ProgressBar';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import Switch from '../../components/Switch';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  AI_MODULE_LABELS, AI_PROVIDER_LABELS, aiModuleLabel, authMethodLabel, labelWithCode, subscriptionLabel,
} from './aiLabels';
import { seatHealth } from './claudeTeamHealthModel';
import './AIProviderSettings.css';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';

const PROVIDERS = Object.entries(AI_PROVIDER_LABELS).map(([id, label]) => ({ id, label }));
const PROVIDER_OPTIONS = PROVIDERS.map((p) => ({ value: p.id, label: p.label }));
const ACCOUNT_FORM_ID = 'claude-team-account-form';

// Remount a settings form when its server values change (after a save or
// "Cek ulang"), so its fields show what the server now holds.
const serverKey = (value) => JSON.stringify(value ?? null);

export default function AIProviderSettings() {
  const { user } = useAuth();
  const canManageModules = Boolean(user?.permissions?.includes('ai.config.manage'));

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState(null);
  const [modules, setModules] = useState([]);
  const [accountModal, setAccountModal] = useState(null); // { account } | { account: null } for create
  const [deleteAccountId, setDeleteAccountId] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/ai/provider-settings');
      const d = r.data?.data;
      // An unexpected answer shows the load error, never a crashed page.
      if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Pengaturan AI tidak dapat dibaca.');
      const list = (v) => (Array.isArray(v) ? v : []);
      setData({ ...d, claudeTeamAccounts: list(d.claudeTeamAccounts), divisionAssignments: list(d.divisionAssignments), departments: list(d.departments) });
      if (canManageModules) {
        const m = await api.get('/ai/modules');
        setModules(m.data.data || []);
      }
    } catch (e) {
      setLoadError(errorMessage(e, 'Pengaturan AI tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [canManageModules]);

  useEffect(() => { load(); }, [load]);

  const setModuleProvider = async (module, provider) => {
    try {
      await api.patch(`/ai/modules/${encodeURIComponent(module)}`, { provider });
      setModules((rows) => rows.map((row) => (row.module === module ? { ...row, provider } : row)));
    } catch (e) {
      toast(errorMessage(e, `Mesin AI ${aiModuleLabel(module)} gagal diubah.`), 'error');
    }
  };

  const deleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await api.delete(`/ai/provider-settings/claude-team/accounts/${deleteAccountId}`);
      toast('Akun dihapus', 'success');
      setDeleteAccountId(null);
      await load();
    } catch (e) {
      toast(errorMessage(e, 'Akun gagal dihapus'), 'error');
      setDeleteAccountId(null);
    } finally {
      setDeletingAccount(false);
    }
  };

  const header = (
    <PageHeader
      title="Pengaturan penyedia AI"
      description="Mesin AI yang dipakai Prakasa AI: akun Claude Team, mesin default dan per divisi, serta kunci API penyedia lain."
    />
  );

  if (!data) {
    return (
      <Page>
        {header}
        {loading ? <LoadingState label="Memuat pengaturan…" skeleton="form" /> : (
          <EmptyState
            tone="error"
            title="Pengaturan AI gagal dimuat"
            description={loadError}
            action={<Button variant="text" type="button" onClick={load}>Coba lagi</Button>}
          />
        )}
      </Page>
    );
  }

  const hasCliAccount = data.claudeTeamAccounts.some((a) => a.mode === 'cli');
  const deleteAccountLabel = data.claudeTeamAccounts.find((a) => a.id === deleteAccountId)?.label;

  const accountColumns = [
    { key: 'label', header: 'Akun' },
    { key: 'mode', header: 'Mode', translate: true, render: (account) => (account.mode === 'cli' ? 'CLI (server ini)' : 'Gateway') },
    { key: 'enabled', header: 'Status', render: (account) => <StatusBadge status={account.enabled ? 'active' : 'inactive'} /> },
    {
      key: 'model',
      header: 'Model',
      render: (account) => (
        <span className="pw-cell">
          <span className="pw-cell__title">{account.model}{account.webResearch ? <Translate>{' · riset web aktif'}</Translate> : ''}</span>
          {account.mode === 'gateway' && account.gatewayUrl ? <span className="pw-cell__meta">{account.gatewayUrl}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <Page>
      {header}
      {loadError ? <Banner tone="error" action={<Button variant="text" onClick={load}>Coba lagi</Button>}>{loadError}</Banner> : null}

      <Card
        variant="panel"
        size="sm"
        title="Akun Claude di server (mode CLI)"
        subtitle="Ditentukan oleh login Claude Code di komputer yang menjalankan backend, bukan dari aplikasi."
        actions={<Button variant="secondary" icon="refresh" onClick={load} loading={loading}>Cek ulang</Button>}
      >
        <div className="pw-stack">
          <CliStatus cli={data.cli} />
          {(data.claudeTeamSeats || []).map((seat) => <SeatHealth key={seat.accountId} health={seat} />)}
          <p className="ai-provider__note">
            Untuk mengganti akun, jalankan <code>claude auth logout</code> lalu <code>claude auth login</code> di server tersebut.
            Hanya boleh ada satu akun bermode CLI; akun tambahan memakai mode gateway.
          </p>
        </div>
      </Card>

      <DataGrid
        title="Akun Claude Team"
        columns={accountColumns}
        rows={data.claudeTeamAccounts}
        empty="Belum ada akun Claude Team"
        searchable={false}
        exportable={false}
        toolbarActions={<Button variant="secondary" icon="add" onClick={() => setAccountModal({ account: null })}>Tambah akun</Button>}
        onRowClick={(account) => setAccountModal({ account })}
        rowActions={(account) => (
          <>
            <IconButton size="sm" icon="edit" label={`Ubah ${account.label}`} onClick={() => setAccountModal({ account })} />
            <IconButton size="sm" icon="delete" label={`Hapus ${account.label}`} tone="danger" onClick={() => setDeleteAccountId(account.id)} />
          </>
        )}
      />

      <RoutingCard key={serverKey(data.routing)} data={data} onSaved={load} />

      {PROVIDERS.filter((p) => p.id !== 'claude_team').map((p) => (
        <ProviderConfigCard
          key={`${p.id}:${serverKey(data.providers.find((row) => row.provider === p.id))}`}
          provider={p.id}
          label={p.label}
          config={data.providers.find((row) => row.provider === p.id)}
          onSaved={load}
        />
      ))}

      {canManageModules && (
        <>
          <Banner tone="info">
            Mesin AI per modul menimpa mesin default atau divisi untuk satu modul saja. Biarkan di Claude Team kecuali ada kebutuhan khusus.
          </Banner>
          <DataGrid
            title="Mesin AI per modul (lanjutan)"
            rows={modules}
            idKey="module"
            exportable={false}
            searchPlaceholder="Cari modul"
            empty="Belum ada modul AI"
            columns={[
              {
                key: 'module',
                header: 'Modul',
                translate: true,
                render: (row) => (
                  <span className="pw-cell">
                    <span className="pw-cell__title" data-no-translate={AI_MODULE_LABELS[row.module] ? undefined : ''}>{aiModuleLabel(row.module)}</span>
                    <span data-no-translate="" className="pw-cell__meta">{row.module}</span>
                  </span>
                ),
                exportValue: (row) => labelWithCode(aiModuleLabel(row.module), row.module),
              },
              {
                key: 'provider',
                header: 'Mesin AI',
                translate: true,
                searchable: false,
                display: true,
                render: (row) => (
                  <Select
                    dense
                    value={row.provider}
                    onChange={(e) => setModuleProvider(row.module, e.target.value)}
                    label={`Mesin AI untuk ${aiModuleLabel(row.module)}`}
                    options={PROVIDER_OPTIONS}
                  />
                ),
              },
            ]}
          />
        </>
      )}

      {accountModal && (
        <AccountFormDialog
          account={accountModal.account}
          hasCliAccount={hasCliAccount}
          onClose={() => setAccountModal(null)}
          onSaved={async () => { setAccountModal(null); await load(); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteAccountId)}
        title={`Hapus akun ${deleteAccountLabel || 'Claude Team'}?`}
        message="Akun yang sedang dipakai sebagai default atau oleh sebuah divisi tidak bisa dihapus."
        confirmLabel="Hapus akun"
        tone="danger"
        loading={deletingAccount}
        onClose={() => { if (!deletingAccount) setDeleteAccountId(null); }}
        onConfirm={deleteAccount}
      />
    </Page>
  );
}

function CliStatus({ cli }) {
  if (!cli) return null;
  if (cli.mode === 'gateway') {
    return <Banner tone="info"><Translate strict>{cli.message}</Translate></Banner>;
  }
  if (!cli.available) {
    return <Banner tone="error"><Translate strict>{cli.message}</Translate></Banner>;
  }

  const warnings = [];
  if (!cli.loggedIn) warnings.push('Claude Code belum masuk ke akun di server.');
  if (cli.loggedIn && cli.subscriptionType !== 'team') warnings.push(`Langganan bukan Team (${cli.subscriptionType ? subscriptionLabel(cli.subscriptionType) : 'tidak diketahui'}).`);
  if (cli.loggedIn && cli.authMethod !== 'claude.ai') warnings.push('Tidak masuk dengan akun claude.ai (bisa jadi memakai kunci API berbayar).');

  return (
    <div className="pw-stack pw-stack--sm">
      <KeyValue
        columns={2}
        items={[
          { label: 'Status', value: <StatusBadge status={cli.loggedIn ? 'active' : 'inactive'} label={cli.loggedIn ? 'Sudah masuk' : 'Belum masuk'} /> },
          { label: 'Email', value: cli.email },
          { label: 'Organisasi', value: cli.orgName },
          { label: 'Langganan', value: subscriptionLabel(cli.subscriptionType), translate: true },
          { label: 'Metode masuk', value: authMethodLabel(cli.authMethod), translate: true },
        ]}
      />
      {warnings.map((w) => (
        <Banner key={w} tone="warning">{w}</Banner>
      ))}
    </div>
  );
}

// Usage window of the one seat behind Prakasa AI, and its queue.
function SeatHealth({ health }) {
  const view = seatHealth(health);
  if (!view) return null;
  return (
    <div className="pw-stack pw-stack--sm">
      <Banner tone={view.tone} title={(
        // The account label is typed by an admin: its own node, never translated.
        <>
          {health.label ? <><NoTranslate>{health.label}</NoTranslate>{' ('}{health.mode === 'gateway' ? 'runner' : 'server ini'}{')'}</> : 'Claude Team'}
          {': '}
          {view.headline}
        </>
      )}
      >
        {view.pct != null
          ? `${view.windowLabel} terpakai ${view.pct}%${view.resetsAt ? `, pulih ${view.resetsAt}` : ''}. Prakasa AI berhenti sementara bila kuota habis, lalu jalan lagi sendiri.`
          : 'Data kuota muncul setelah jawaban AI pertama.'}
      </Banner>
      {view.pct != null ? (
        <ProgressBar value={Math.min(100, view.pct)} tone={view.tone === 'error' ? 'error' : 'default'} label="Kuota Claude Team terpakai" />
      ) : null}
      {view.queue ? <p className="ai-provider__note">Antrean saat ini: {view.queue}</p> : null}
    </div>
  );
}

function AccountFormDialog({ account, hasCliAccount, onClose, onSaved }) {
  const isEdit = Boolean(account);
  const [form, setForm] = useState({
    label: account?.label || '',
    mode: account?.mode || (hasCliAccount ? 'gateway' : 'cli'),
    gatewayUrl: account?.gatewayUrl || '',
    gatewaySecret: '',
    model: account?.model || 'sonnet',
    webResearch: account?.webResearch || false,
    enabled: account?.enabled ?? true,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const close = () => { if (!saving) onClose(); };

  const save = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.label.trim()) nextErrors.label = 'Isi nama akun.';
    if (form.mode === 'gateway' && !form.gatewayUrl.trim()) nextErrors.gatewayUrl = 'Isi URL gateway.';
    if (form.mode === 'gateway' && form.gatewaySecret && form.gatewaySecret.length < 16) nextErrors.gatewaySecret = 'Kunci rahasia minimal 16 karakter.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        label: form.label,
        mode: form.mode,
        model: form.model,
        webResearch: form.webResearch,
        enabled: form.enabled,
        ...(form.mode === 'gateway' ? { gatewayUrl: form.gatewayUrl } : {}),
        ...(form.mode === 'gateway' && form.gatewaySecret ? { gatewaySecret: form.gatewaySecret } : {}),
      };
      if (isEdit) await api.patch(`/ai/provider-settings/claude-team/accounts/${account.id}`, payload);
      else await api.post('/ai/provider-settings/claude-team/accounts', payload);
      toast(isEdit ? 'Akun diperbarui' : 'Akun ditambahkan', 'success');
      await onSaved();
    } catch (e) {
      const fieldErrors = fieldErrorsFromApi(e);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else setError(errorMessage(e, 'Akun gagal disimpan'));
    } finally {
      setSaving(false);
    }
  };

  const secretHint = [
    'Minimal 16 karakter.',
    isEdit && account.gatewaySecret?.set ? `Tersimpan: ${account.gatewaySecret.preview}. Kosongkan bila tidak diubah.` : '',
  ].filter(Boolean).join(' ');

  return (
    <FullScreenDialog
      open
      onClose={close}
      title={isEdit ? `Ubah akun ${account.label}` : 'Tambah akun Claude Team'}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={close} disabled={saving}>Batal</Button>
          <Button type="submit" form={ACCOUNT_FORM_ID} loading={saving}>Simpan akun</Button>
        </>
      )}
    >
      <form id={ACCOUNT_FORM_ID} className="ai-provider__dialog-form" onSubmit={save} noValidate>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <FullScreenSection title="Informasi akun">
          <div className="pw-fsdialog__fields">
            <Input
              label="Nama akun"
              required
              value={form.label}
              error={errors.label}
              hint="Contoh Akun Sales Cabang B."
              onChange={(e) => set('label', e.target.value)}
              autoFocus
            />
            <Select
              label="Mode"
              value={form.mode}
              error={errors.mode}
              onChange={(e) => set('mode', e.target.value)}
              options={[
                {
                  value: 'cli',
                  label: `CLI: login langsung di server ini${hasCliAccount ? ' (sudah dipakai)' : ''}`,
                  disabled: hasCliAccount && form.mode !== 'cli',
                },
                { value: 'gateway', label: 'Gateway: server lain yang sudah login terpisah' },
              ]}
            />
            {form.mode === 'gateway' && (
              <>
                <Input
                  label="URL gateway"
                  required
                  value={form.gatewayUrl}
                  error={errors.gatewayUrl}
                  hint="Contoh https://gateway-cabang-b.internal:3199"
                  onChange={(e) => set('gatewayUrl', e.target.value)}
                />
                <Input
                  label="Kunci rahasia gateway"
                  type="password"
                  autoComplete="new-password"
                  hint={secretHint}
                  error={errors.gatewaySecret}
                  value={form.gatewaySecret}
                  onChange={(e) => set('gatewaySecret', e.target.value)}
                />
              </>
            )}
            <Input
              label="Model"
              value={form.model}
              error={errors.model}
              hint="Contoh sonnet."
              onChange={(e) => set('model', e.target.value)}
            />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Pengaturan">
          <div className="ai-provider__switches">
            <Switch label="Izinkan riset web untuk akun ini" checked={form.webResearch} onChange={(e) => set('webResearch', e.target.checked)} />
            <Switch label="Akun aktif" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          </div>
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

function RoutingCard({ data, onSaved }) {
  const [defaultProvider, setDefaultProvider] = useState(data.routing.defaultProvider);
  const [defaultAccountId, setDefaultAccountId] = useState(data.routing.defaultClaudeTeamAccountId || '');
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef(null);

  const assignedIds = new Set(data.divisionAssignments.map((a) => a.departmentId));
  const availableDepartments = data.departments.filter((d) => !assignedIds.has(d.id));
  const accountOptions = data.claudeTeamAccounts.map((a) => ({ value: a.id, label: a.label }));

  const saveDefault = async () => {
    setSaving(true);
    try {
      await api.put('/ai/provider-settings/routing', {
        defaultProvider,
        defaultClaudeTeamAccountId: defaultProvider === 'claude_team' ? Number(defaultAccountId) : null,
      });
      toast('Mesin AI default disimpan', 'success');
      await onSaved();
    } catch (e) {
      toast(errorMessage(e, 'Mesin AI default gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveDivision = async (departmentId, provider, claudeTeamAccountId) => {
    try {
      await api.put(`/ai/provider-settings/routing/divisions/${departmentId}`, {
        provider,
        claudeTeamAccountId: provider === 'claude_team' ? claudeTeamAccountId : null,
      });
      await onSaved();
    } catch (e) {
      toast(errorMessage(e, 'Mesin AI divisi gagal disimpan.'), 'error');
    }
  };

  const removeDivision = async (departmentId) => {
    try {
      await api.delete(`/ai/provider-settings/routing/divisions/${departmentId}`);
      toast('Divisi kembali memakai mesin AI default', 'success');
      await onSaved();
    } catch (e) {
      toast(errorMessage(e, 'Penetapan divisi gagal dihapus.'), 'error');
    }
  };

  return (
    <>
      <Card
        variant="panel"
        size="sm"
        title="Mesin AI default"
        subtitle="Semua divisi memakai mesin default kecuali ditetapkan lain. Semua peran otomatis punya akses AI; ini hanya menentukan mesin yang dipakai."
      >
        <div className="pw-stack">
          <div className="ai-provider__fields">
            <Select
              label="Mesin AI default (semua divisi)"
              value={defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value)}
              options={PROVIDER_OPTIONS}
            />
            {defaultProvider === 'claude_team' && (
              <Select
                label="Akun Claude Team"
                value={defaultAccountId}
                onChange={(e) => setDefaultAccountId(e.target.value)}
                placeholder="Pilih akun"
                options={accountOptions}
                dataOptions
              />
            )}
          </div>
          <FormActions>
            <Button onClick={saveDefault} loading={saving}>Simpan default</Button>
          </FormActions>
        </div>
      </Card>

      <DataGrid
        title="Penetapan khusus per divisi"
        rows={data.divisionAssignments}
        idKey="departmentId"
        searchable={false}
        exportable={false}
        empty="Belum ada divisi dengan mesin AI khusus. Semua memakai default."
        toolbarActions={availableDepartments.length > 0 ? (
          <>
            <Button
              ref={addRef}
              variant="secondary"
              icon="add"
              aria-haspopup="menu"
              aria-expanded={addOpen}
              onClick={() => setAddOpen((open) => !open)}
            >
              Tambah penetapan
            </Button>
            <Menu
              open={addOpen}
              anchorRef={addRef}
              onClose={() => setAddOpen(false)}
              label="Pilih divisi"
              items={availableDepartments.map((d) => ({
                key: d.id,
                label: d.name,
                onClick: () => saveDivision(Number(d.id), defaultProvider, Number(defaultAccountId) || null),
              }))}
            />
          </>
        ) : null}
        rowActions={(row) => (
          <IconButton size="sm" icon="undo" label={`Kembalikan ${row.departmentName} ke default`} tone="danger" onClick={() => setRemoveTarget(row)} />
        )}
        columns={[
          { key: 'departmentName', header: 'Divisi', translate: true },
          {
            key: 'provider',
            header: 'Mesin AI',
            translate: true,
            display: true,
            render: (row) => (
              <Select
                dense
                label={`Mesin AI untuk ${row.departmentName}`}
                value={row.provider}
                onChange={(e) => saveDivision(row.departmentId, e.target.value, row.claudeTeamAccountId)}
                options={PROVIDER_OPTIONS}
              />
            ),
          },
          {
            key: 'claudeTeamAccountId',
            header: 'Akun',
            translate: true,
            display: true,
            render: (row) => (row.provider === 'claude_team' ? (
              <Select
                dense
                label={`Akun Claude Team untuk ${row.departmentName}`}
                value={row.claudeTeamAccountId || ''}
                onChange={(e) => saveDivision(row.departmentId, 'claude_team', Number(e.target.value))}
                placeholder="Default"
                options={accountOptions}
                dataOptions
              />
            ) : null),
          },
        ]}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Hapus penetapan divisi?"
        message={`${removeTarget?.departmentName || 'Divisi ini'} akan kembali memakai mesin AI default.`}
        confirmLabel="Hapus penetapan"
        tone="danger"
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => { const target = removeTarget; setRemoveTarget(null); removeDivision(target.departmentId); }}
      />
    </>
  );
}

function ProviderConfigCard({ provider, label, config, onSaved }) {
  const [enabled, setEnabled] = useState(config?.enabled || false);
  const [model, setModel] = useState(config?.model || '');
  const [apiKey, setApiKey] = useState('');
  const [gatewayUrl, setGatewayUrl] = useState(config?.config?.gatewayUrl || '');
  const [gatewaySecret, setGatewaySecret] = useState('');
  const [saving, setSaving] = useState(false);
  const isGatewayStyle = provider === 'n8n';
  const secretPreview = isGatewayStyle ? config?.config?.gatewaySecret?.preview : config?.config?.apiKey?.preview;
  const secretSet = isGatewayStyle ? config?.config?.gatewaySecret?.set : config?.config?.apiKey?.set;
  const secretHint = secretSet ? `Tersimpan: ${secretPreview}. Kosongkan bila tidak diubah.` : 'Belum diisi.';

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { enabled, model };
      if (isGatewayStyle) {
        payload.gatewayUrl = gatewayUrl;
        if (gatewaySecret) payload.gatewaySecret = gatewaySecret;
      } else if (apiKey) {
        payload.apiKey = apiKey;
      }
      await api.patch(`/ai/provider-settings/providers/${provider}`, payload);
      toast(`${label} disimpan`, 'success');
      setApiKey('');
      setGatewaySecret('');
      await onSaved();
    } catch (e) {
      toast(errorMessage(e, `${label} gagal disimpan.`), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="panel" size="sm" title={label}>
      <form className="pw-stack" onSubmit={save} noValidate>
        <Switch label={`Aktifkan ${label}`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <div className="ai-provider__fields">
          <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
          {isGatewayStyle ? (
            <>
              <Input
                label="URL gateway"
                value={gatewayUrl}
                hint="Contoh https://n8n.internal/webhook/ai"
                onChange={(e) => setGatewayUrl(e.target.value)}
              />
              <Input
                label="Kunci rahasia"
                type="password"
                autoComplete="new-password"
                hint={secretHint}
                value={gatewaySecret}
                onChange={(e) => setGatewaySecret(e.target.value)}
              />
            </>
          ) : (
            <Input
              label="Kunci API"
              type="password"
              autoComplete="new-password"
              hint={secretHint}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}
        </div>
        <FormActions>
          <Button type="submit" loading={saving}>Simpan {label}</Button>
        </FormActions>
      </form>
    </Card>
  );
}
