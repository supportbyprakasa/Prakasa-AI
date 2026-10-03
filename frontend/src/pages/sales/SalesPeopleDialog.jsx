import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog from '../../components/FullScreenDialog';
import Select from '../../components/Select';
import DataGrid from '../../components/datagrid/DataGrid';
import { toast } from '../../components/Toast';
import { apiError, formatCount } from './salesModel';
import { NoTranslate } from '../../i18n/NoTranslate';

// Maps each salesperson name in the imported data (a name like "Fajar" or
// "Liani / Windy") to an app account. Records entered in the app carry their
// PIC account directly. A Sales member sees only the customers, leads and
// orders whose names map to them. Suggestions are shown, never saved on their own.
export default function SalesPeopleDialog({ open, onClose, onSaved }) {
  const [state, setState] = useState({ loading: true, error: '', people: [], users: [] });
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.get('/sales/people')
      .then((r) => {
        const { people, users } = r.data.data;
        setState({ loading: false, error: '', people, users });
        setDraft(Object.fromEntries(people.map((p) => [p.name, p.userId ? String(p.userId) : ''])));
      })
      .catch((err) => setState((s) => ({ ...s, loading: false, error: apiError(err) })));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const userOptions = useMemo(
    () => state.users.map((u) => ({ value: String(u.id), label: `${u.name} · ${u.departmentName}` })),
    [state.users],
  );
  const userName = useMemo(() => new Map(state.users.map((u) => [u.id, u.name])), [state.users]);
  const changed = state.people.filter((p) => (draft[p.name] || '') !== (p.userId ? String(p.userId) : ''));
  const suggestions = state.people.filter((p) => p.suggestedUserId && !draft[p.name]);

  const applySuggestions = () => setDraft((d) => {
    const next = { ...d };
    for (const p of suggestions) next[p.name] = String(p.suggestedUserId);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/sales/people', {
        mappings: changed.map((p) => ({ name: p.name, userId: draft[p.name] ? Number(draft[p.name]) : null })),
      });
      toast('Pemetaan nama sales disimpan', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(apiError(err, 'Pemetaan gagal disimpan'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'name', header: 'Nama di data' },
    {
      key: 'total', header: 'Dipakai di', translate: true, sortValue: (p) => p.customers + p.orders + p.leads,
      render: (p) => [
        p.customers ? `${formatCount(p.customers)} pelanggan` : null,
        p.orders ? `${formatCount(p.orders)} order` : null,
        p.leads ? `${formatCount(p.leads)} lead` : null,
      ].filter(Boolean).join(' · '),
      exportValue: (p) => `${p.customers} pelanggan, ${p.orders} order, ${p.leads} lead`,
    },
    {
      // Interface text (placeholder, "Saran:") around people's names, which stay data.
      key: 'userId', header: 'Akun aplikasi', translate: true,
      render: (p) => (
        <span className="pw-cell">
          <Select
            dense
            aria-label={`Akun untuk ${p.name}`}
            value={draft[p.name] || ''}
            onChange={(e) => setDraft((d) => ({ ...d, [p.name]: e.target.value }))}
            options={userOptions}
            dataOptions
            placeholder="Belum dipetakan"
          />
          {p.suggestedUserId && !draft[p.name] ? <span className="pw-cell__meta">Saran: <NoTranslate>{userName.get(p.suggestedUserId)}</NoTranslate></span> : null}
        </span>
      ),
      exportValue: (p) => userName.get(Number(draft[p.name])) || '',
    },
  ];

  let body;
  if (state.loading) body = <LoadingState label="Memuat nama sales…" />;
  else if (state.error) {
    body = <EmptyState tone="error" title="Nama sales belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  } else {
    body = <DataGrid title="Nama sales" showTitle={false} columns={columns} rows={state.people} idKey="name" exportName="pemetaan-sales" pageSize={50} />;
  }

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={changed.length > 0 && !saving}
      title="Pemetaan nama sales"
      sectionTitle="Nama sales ke akun aplikasi"
      actions={(
        <>
          {suggestions.length ? <Button variant="text" type="button" onClick={applySuggestions}>Pakai {suggestions.length} saran</Button> : null}
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="button" onClick={save} loading={saving} disabled={!changed.length}>
            Simpan{changed.length ? ` (${changed.length})` : ''}
          </Button>
        </>
      )}
    >
      <p className="pw-text-helper">
        Nama sales di data awal (hasil impor) dihubungkan ke akun aplikasi; data baru langsung memakai PIC-nya. Sales Member hanya melihat
        customer, lead, dan order dengan namanya; Supervisor dan Head tetap melihat semua. Nama gabungan seperti
        &quot;Liani / Windy&quot; dipetakan per orang.
      </p>
      {body}
    </FullScreenDialog>
  );
}
