import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import ProgressBar from '../../components/ProgressBar';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  apiError, formatCount, formatRupiah, formatRupiahShort, monthLabel, todayIso,
} from './salesModel';

// Monthly targets per salesperson: revenue and new customers (NOO), with a
// progress bar each. A member sees their own; supervisors see the team and set
// the targets.

const thisMonth = () => todayIso().slice(0, 7);

function Progress({ label, actual, target, pct, format }) {
  return (
    <div className="sales-progress">
      <div className="sales-progress__head">
        <span className="pw-text-helper">{label}</span>
        <span className="pw-text-sm">
          {format(actual)}
          <span className="pw-muted">{target !== null ? ` / ${format(target)}` : ' · belum ada target'}</span>
          {pct !== null ? <span className="pw-strong"> · {formatCount(pct)}%</span> : null}
        </span>
      </div>
      <ProgressBar value={pct === null ? 0 : Math.min(100, pct)} label={label} />
    </div>
  );
}

// One row per salesperson, two figures each: a long form (full-screen dialog).
function TargetForm({ open, month, rows, onClose, onSaved }) {
  const formId = useId();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setDraft(Object.fromEntries(rows.map((r) => [r.userId, {
      revenue: r.revenueTarget === null ? '' : String(r.revenueTarget),
      noo: r.nooTarget === null ? '' : String(r.nooTarget),
    }])));
  }, [open, rows]);
  const set = (userId, key) => (e) => { setTouched(true); setDraft((d) => ({ ...d, [userId]: { ...d[userId], [key]: e.target.value } })); };
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/sales/targets', {
        month,
        targets: rows.map((r) => ({
          userId: r.userId,
          revenueTarget: draft[r.userId]?.revenue === '' ? null : Number(draft[r.userId]?.revenue),
          nooTarget: draft[r.userId]?.noo === '' ? null : Number(draft[r.userId]?.noo),
        })),
      });
      toast('Target disimpan', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(apiError(err, 'Target gagal disimpan'), 'error');
    } finally { setSaving(false); }
  };
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={touched && !saving}
      title={`Atur target · ${monthLabel(month)}`}
      sectionTitle="Target per sales"
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan target</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit}>
        <p className="pw-text-helper">Kosongkan bila tidak ada target. Pencapaian dihitung dari order dan pelanggan milik tiap sales.</p>
        {rows.map((r) => (
          <div key={r.userId} className="sales-target-row">
            <div className="pw-cell">
              <span data-no-translate="" className="pw-cell__title">{r.name}</span>
              <span className="pw-cell__meta">{r.departmentName}</span>
            </div>
            <Input label="Target omzet sebelum PPN" type="number" min="0" value={draft[r.userId]?.revenue ?? ''} onChange={set(r.userId, 'revenue')} hint="Rupiah" />
            <Input label="Target pelanggan baru" type="number" min="0" step="1" value={draft[r.userId]?.noo ?? ''} onChange={set(r.userId, 'noo')} />
          </div>
        ))}
      </form>
    </FullScreenDialog>
  );
}

export default function SalesTargets() {
  const { user } = useAuth();
  const canSet = (user?.permissions || []).includes('sales.master.manage');
  const [month, setMonth] = useState(thisMonth());
  const canMap = canSet;
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/sales/targets', { params: { month } });
      setState({ loading: false, error: '', rows: r.data.data?.rows || [] });
    } catch (err) {
      setState({ loading: false, error: apiError(err), rows: [] });
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  let body;
  if (state.loading) body = <LoadingState compact label="Memuat target…" />;
  else if (state.error) {
    body = <EmptyState compact tone="error" title="Target belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  } else if (!state.rows.length) {
    body = <EmptyState compact icon="track_changes" title="Belum ada akun sales" description="Target dipasang per akun divisi Sales atau Retail Commerce." />;
  } else {
    // An account linked to no Accurate salesperson name and no customer has no
    // pencapaian yet — say how to link it instead of showing a misleading 0.
    const mapAction = canMap
      ? <Button variant="secondary" icon="manage_accounts" onClick={() => navigate('/sales/customers?pemetaan=1')}>Buka Pemetaan sales</Button>
      : null;
    const noneLinked = state.rows.every((r) => r.linked === false);
    body = (
      <div className="pw-stack">
        {noneLinked ? (
          <EmptyState
            compact
            icon="link_off"
            title="Hubungkan nama sales Accurate ke akun karyawan"
            description={`Pencapaian per sales dihitung dari faktur yang nama salesnya dipetakan ke akun karyawan, atau dari pelanggan milik akun itu. Belum ada akun yang terhubung, jadi pencapaian belum bisa dihitung (bukan nol). ${canMap ? 'Petakan di Pelanggan → Pemetaan sales.' : 'Minta Supervisor Sales memetakan di Pelanggan → Pemetaan sales.'}`}
            action={mapAction}
          />
        ) : null}
        <div className="sales-targets">
          {state.rows.map((r) => (
            <div key={r.userId} className="sales-targets__row">
              <div className="pw-cell">
                <span data-no-translate="" className="pw-cell__title">{r.name}</span>
                <span className="pw-cell__meta">{r.linked === false ? 'Belum terhubung ke nama sales Accurate' : `${formatCount(r.orders)} sales order`}</span>
              </div>
              {r.linked === false ? (
                <p className="pw-text-helper">Pencapaian belum bisa dihitung: akun ini belum dihubungkan ke nama sales Accurate atau pelanggan.</p>
              ) : (
                <>
                  <Progress label="Omzet (sebelum PPN)" actual={r.revenueActual} target={r.revenueTarget} pct={r.revenuePct} format={(v) => (v >= 1e6 ? formatRupiahShort(v) : formatRupiah(v))} />
                  <Progress label="Pelanggan baru (NOO)" actual={r.nooActual} target={r.nooTarget} pct={r.nooPct} format={formatCount} />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card
      title="Target dan pencapaian"
      actions={(
        <>
          <DateInput type="month" dense label="Bulan" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} fieldClassName="sales-month" />
          {canSet && state.rows.length ? <Button variant="secondary" icon="track_changes" onClick={() => setEditing(true)}>Atur target</Button> : null}
        </>
      )}
    >
      {body}
      <TargetForm open={editing} month={month} rows={state.rows} onClose={() => setEditing(false)} onSaved={load} />
    </Card>
  );
}
