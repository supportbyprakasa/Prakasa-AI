import { useState } from 'react';
import Banner from '../../components/Banner';
import Chip from '../../components/Chip';
import IconButton from '../../components/IconButton';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatCount } from './salesModel';
import useSalesList from './useSalesList';
import { useAccurateSource, useTransactionsReliable } from './SalesScopeBanner';
import { Mixed, data } from '../../i18n/NoTranslate';

// "Perlu tindakan hari ini": what needs doing now, one kind of work per chip,
// and on every row the one button that does it.

const DAYS = {
  dormant: (d) => `${d} hari tanpa order`,
  no_do: (d) => (d > 0 ? `lewat ${d} hari dari tanggal kirim` : 'dikirim hari ini/besok'),
  overdue: (d) => `terlambat ${d} hari`,
  leads: (d) => (d === null ? 'belum pernah dikunjungi' : `${d} hari sejak kunjungan`),
};

const TITLE = {
  dormant: 'Pelanggan', no_do: 'Sales order', overdue: 'Invoice', leads: 'Outlet',
};

function columns(type, reliable) {
  return [
    {
      key: 'title',
      header: TITLE[type],
      render: (r) => (
        <span className="pw-cell">
          <span className="pw-cell__title">{r.title}</span>
          <span className="pw-cell__meta"><Mixed parts={[data(r.reference), r.context ? { text: r.context, strict: true } : null]} /></span>
        </span>
      ),
      exportValue: (r) => r.title,
    },
    { key: 'salesPersonName', header: 'Sales' },
    {
      key: 'days', header: 'Kondisi', translate: true,
      render: (r) => {
        const text = DAYS[type](r.days);
        const urgent = reliable && (type === 'overdue' || (type === 'dormant' && r.days >= 50));
        return urgent ? <StatusBadge status="overdue" label={text} /> : text;
      },
      exportValue: (r) => DAYS[type](r.days),
    },
    type === 'overdue' || type === 'no_do'
      ? { key: 'amount', header: type === 'overdue' ? 'Sisa tagihan' : 'Nilai', type: 'money' }
      : { key: 'since', header: type === 'dormant' ? 'Order terakhir' : 'Kunjungan terakhir', type: 'date' },
  ];
}

const action = (label, icon, props) => <IconButton size="sm" label={label} icon={icon} {...props} />;

function actionFor(type, r, accurate) {
  // Approved Accurate documents have no page of their own here: open the customer.
  if (r.source === 'accurate') {
    return r.customerId ? action('Lihat pelanggan', 'person', { to: `/sales/customers/${r.customerId}` }) : null;
  }
  if (type === 'dormant') {
    return (
      <>
        {r.phone ? action('Telepon', 'call', { href: `tel:${r.phone}` }) : null}
        {action('Lihat pelanggan', 'visibility', { to: `/sales/customers/${r.id}` })}
      </>
    );
  }
  if (type === 'leads') return action('Catat kunjungan', 'edit_calendar', { to: `/sales/leads?lead=${r.id}` });
  // In Accurate mode the paperwork is done in Accurate; here the row opens the
  // SO so the salesperson knows exactly which one to chase there.
  if (type === 'no_do') {
    return accurate
      ? action('Lihat SO', 'visibility', { to: `/sales/orders/${r.id}` })
      : action('Buat surat jalan', 'local_shipping', { to: `/sales/orders/${r.id}?aksi=surat-jalan` });
  }
  return accurate
    ? action('Lihat SO', 'visibility', { to: `/sales/orders/${r.id}` })
    : action('Catat pembayaran', 'payments', { to: `/sales/orders/${r.id}?aksi=bayar` });
}

export default function SalesTodo() {
  const accurate = useAccurateSource();
  const reliable = useTransactionsReliable();
  // Opens on overdue invoices: the Dormant list is already the stage grid's
  // default right below, so the two blocks never show the same customers.
  const [type, setType] = useState('overdue');
  const list = useSalesList('/sales/actions', { type }, { limit: 10 });
  const types = list.meta.types || [];
  const current = types.find((t) => t.key === type);
  const oldData = !reliable && current?.key !== 'leads';
  return (
    <div className="pw-stack">
      {current?.hint || oldData ? (
        <Banner tone={oldData ? 'warning' : 'neutral'}>
          {[
            current?.hint ? `${current.label}: ${current.hint}${/[.!?]$/.test(current.hint) ? '' : '.'}` : '',
            oldData ? 'Dari data lama: belum tersambung Accurate, jadi bisa berbeda dengan pembukuan. Pengingat untuk ini ditahan dulu.' : '',
          ].filter(Boolean).join(' ')}
        </Banner>
      ) : null}
      <DataGrid
        key={type}
        title="Perlu tindakan hari ini"
        columns={columns(type, reliable)}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        searchable={false}
        filters={types.length ? types.map((t) => (
          <Chip key={t.key} selected={type === t.key} onClick={() => setType(t.key)} tooltip={t.hint}>
            {t.label} ({formatCount(t.count)})
          </Chip>
        )) : null}
        exportName={`perlu-tindakan-${type}`}
        rowActions={(r) => actionFor(type, r, accurate)}
        empty="Beres, tidak ada yang perlu ditindaklanjuti di sini."
      />
    </div>
  );
}
