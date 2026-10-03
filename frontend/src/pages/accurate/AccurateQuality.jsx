import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiError } from '../sales/salesModel';
import { moreText, orderChecks, valueText } from './accurateQualityModel';

// "Perlu dibereskan di Accurate" (program 1.4): what approved Accurate data shows
// is wrong in Accurate, per check, to pass on to whoever keys data there. This
// app never changes Accurate; the list clears itself once Accurate is fixed and
// the next batch is approved.
const columns = (key) => [
  { key: 'ref', header: 'Kode / nomor', nowrap: true },
  { key: 'name', header: 'Keterangan' },
  { key: 'detail', header: 'Detail' },
  { key: 'value', header: 'Nilai', align: 'end', translate: true, render: (r) => valueText(key, r.value), exportValue: (r) => r.value },
];

export default function AccurateQuality() {
  const [state, setState] = useState({ loading: true, error: '', checks: [] });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.get('/sales/accurate/quality');
      setState({ loading: false, error: '', checks: Array.isArray(res.data.data) ? res.data.data : [] });
    } catch (err) {
      setState({ loading: false, error: apiError(err), checks: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Memeriksa data Accurate…" />;
  if (state.error) {
    return <EmptyState tone="error" title="Pemeriksaan belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  }
  return (
    <div className="pw-stack pw-stack--lg">
      <Banner tone="info">
        Dari data Accurate yang sudah disetujui divisi. Teruskan ke pengguna Accurate untuk dibereskan di sana; aplikasi ini tidak mengubah Accurate.
        Daftar bersih sendiri setelah Accurate diperbaiki dan batch berikutnya disetujui.
      </Banner>
      {!state.checks.length ? <EmptyState icon="fact_check" title="Belum ada pemeriksaan" description="Pemeriksaan tampil setelah ada data Accurate yang disetujui." /> : null}
      {orderChecks(state.checks).map((check) => {
        const hint = check.count ? [check.fix, moreText(check)].filter(Boolean).join(' ') : '';
        return (
          <div key={check.key} className="pw-stack">
            {hint ? <Banner tone="neutral">{hint}</Banner> : null}
            {/* One item can appear once per gudang, so rows are keyed by position. */}
            <DataGrid
              title={`${check.label} (${check.count || 0})`}
              columns={columns(check.key)}
              rows={check.count ? check.rows.map((r, i) => ({ ...r, id: i })) : []}
              searchable={false}
              exportName={`perlu-dibereskan-${check.key}`}
              empty={<EmptyState compact icon="task_alt" title="Tidak ada temuan" />}
            />
          </div>
        );
      })}
    </div>
  );
}
