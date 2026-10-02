import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber, formatQty } from '../../components/format';
import { apiError, formatRupiah } from './salesModel';
import { agingRows, cellText, overdueShare } from './salesAgingModel';

// Umur piutang per syarat bayar (program 2.3), from approved Accurate invoices.
// The term is read from each invoice (due date − invoice date). The grid is
// its own panel (never inside a Card), on the orders tab and the customer page.
// `label`: names the grid where no tab does (the customer page).
export default function SalesAging({ customerId = null, label = '' }) {
  const [state, setState] = useState({ loading: true, error: '', aging: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.get('/sales/receivables/aging', { params: customerId ? { customerId } : {} });
      setState({ loading: false, error: '', aging: res.data.data });
    } catch (err) {
      setState({ loading: false, error: apiError(err), aging: null });
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Menghitung umur piutang…" />;
  if (state.error) {
    return <EmptyState tone="error" title="Umur piutang belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  }
  const { aging } = state;
  if (!aging?.grand) return <Banner tone="info" title="Umur piutang dari Accurate">Tampil setelah data faktur dari Accurate disetujui divisi.</Banner>;
  if (!aging.grand.invoices) return <EmptyState compact icon="task_alt" title="Tidak ada piutang" description="Semua faktur sudah lunas." />;
  const columns = [
    { key: 'term', header: 'Syarat bayar', translate: true, render: (r) => (r.isTotal ? <span className="pw-strong">{r.term}</span> : r.term), exportValue: (r) => r.term },
    ...aging.buckets.map((b) => ({ key: b.key, header: b.label, align: 'end', translate: true, render: (r) => cellText(r[b.key]), exportValue: (r) => r[b.key]?.outstanding || 0 })),
    { key: 'total', header: 'Total', align: 'end', translate: true, render: (r) => <span className="pw-strong">{cellText(r.total)}</span>, exportValue: (r) => r.total?.outstanding || 0 },
  ];
  const share = overdueShare(aging);
  // Two whole sentences (never glue letters to a word: the language switch
  // translates a text as a whole).
  const outstanding = formatRupiah(aging.grand.outstanding);
  const invoices = formatNumber(aging.grand.invoices);
  const title = label
    ? `${label} · piutang ${outstanding} dari ${invoices} faktur`
    : `Piutang ${outstanding} dari ${invoices} faktur`;
  const overdueLink = `/sales/orders?tab=invoice&status=overdue&periode=all${customerId ? `&customerId=${customerId}` : ''}`;
  return (
    <div className="pw-stack">
      <DataGrid
        title={title}
        columns={columns}
        rows={agingRows(aging)}
        searchable={false}
        exportName={customerId ? `umur-piutang-customer-${customerId}` : 'umur-piutang'}
        toolbarActions={<Button variant="text" icon="event_busy" to={overdueLink}>Lihat faktur lewat jatuh tempo</Button>}
      />
      <p className="pw-text-helper">
        {[
          share !== null ? `${formatQty(share)}% dari piutang sudah lewat jatuh tempo.` : '',
          'Dari faktur Accurate yang disetujui; sisa tagihan termasuk PPN; syarat bayar = jatuh tempo dikurangi tanggal faktur.',
        ].filter(Boolean).join(' ')}
      </p>
    </div>
  );
}
