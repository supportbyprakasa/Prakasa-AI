import { useMemo, useState } from 'react';
import ActionMenu from '../../../components/ActionMenu';
import Button from '../../../components/Button';
import Chip from '../../../components/Chip';
import Icon from '../../../components/Icon';
import IconButton from '../../../components/IconButton';
import StatusBadge from '../../../components/StatusBadge';
import { toast } from '../../../components/Toast';
import DataGrid from '../../../components/datagrid/DataGrid';
import Pager from '../../../components/datagrid/Pager';

// Grid work package: DataGrid and Pager in every state, with realistic data (30 rows, long text, numbers, dates, statuses,
// actions, selection, empty, error, loading), for measuring docs/ui-guideline.md
// §4.9 at 1440 / 1024 / 390.

const CUSTOMERS = [
  'Big House Cafe',
  'PT Sumber Rejeki Makmur Abadi Sejahtera (Cabang Kelapa Gading, Jakarta Utara)',
  'Kopi Kenangan Senopati',
  'Hotel Santika Premiere Slipi',
  'Toko Roti Lestari',
  'Warung Nasi Bu Imas',
];
const STATUSES = ['draft', 'pending_approval', 'approved', 'in_progress', 'rejected', 'completed'];
const NOTES = [
  '',
  'Kirim sebelum jam 10 pagi, pintu belakang.',
  'Customer minta faktur dipisah per outlet karena pembayaran lewat kantor pusat yang berbeda.',
  '',
  'Retur 2 karton dari SO sebelumnya.',
];

const ORDERS = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1;
  const day = String(30 - (index % 28)).padStart(2, '0');
  return {
    id: n,
    number: `SO${String(n).padStart(3, '0')}/HRC-PFN/IX/2026`,
    customer: CUSTOMERS[index % CUSTOMERS.length],
    date: `2026-09-${day}`,
    updatedAt: `2026-09-${day}T0${index % 10}:${String((index * 7) % 60).padStart(2, '0')}:00+07:00`,
    qty: ((index * 7) % 45) + 1,
    total: 1250000 + index * 387500,
    status: STATUSES[index % STATUSES.length],
    note: NOTES[index % NOTES.length],
  };
});

const ORDER_COLUMNS = [
  { key: 'number', header: 'No. SO', nowrap: true },
  { key: 'customer', header: 'Customer' },
  { key: 'date', header: 'Tanggal', type: 'date' },
  { key: 'updatedAt', header: 'Diperbarui', type: 'datetime' },
  { key: 'qty', header: 'Qty', type: 'number' },
  { key: 'total', header: 'Total', type: 'money' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} />, exportValue: (row) => row.status },
  { key: 'note', header: 'Catatan' },
];

function Demo({ id, title, children }) {
  return (
    <div className="pw-stack" data-grid-demo={id}>
      <h3 className="pw-overline">{title}</h3>
      {children}
    </div>
  );
}

function FullGrid() {
  const [status, setStatus] = useState('');
  const rows = useMemo(() => (status ? ORDERS.filter((row) => row.status === status) : ORDERS), [status]);
  return (
    <DataGrid
      title="Pesanan penjualan"
      exportName="galeri-pesanan"
      columns={ORDER_COLUMNS}
      rows={rows}
      pageSize={10}
      selectable
      bulkActions={(selected, clear) => (
        <>
          <Button variant="text" type="button" onClick={() => { toast(`${selected.length} pesanan disetujui`, 'success'); clear(); }}>Setujui</Button>
          <Button variant="text" type="button" onClick={() => toast('Contoh saja, tidak ada yang dihapus', 'success')}>Arsipkan</Button>
        </>
      )}
      filters={(
        <>
          <Chip selected={status === ''} onClick={() => setStatus('')}>Semua ({ORDERS.length})</Chip>
          <Chip selected={status === 'pending_approval'} onClick={() => setStatus('pending_approval')}>Menunggu persetujuan (5)</Chip>
          <Chip selected={status === 'rejected'} onClick={() => setStatus('rejected')}>Ditolak (5)</Chip>
        </>
      )}
      toolbarActions={(
        <IconButton label="Muat ulang" onClick={() => toast('Data dimuat ulang', 'success')}>
          <Icon name="refresh" />
        </IconButton>
      )}
      onRowClick={(row) => toast(`Buka ${row.number}`, 'success')}
      rowActions={(row) => (
        <>
          <IconButton label="Ubah" size="sm" onClick={() => toast(`Ubah ${row.number}`, 'success')}><Icon name="edit" /></IconButton>
          <ActionMenu items={[
            { label: 'Cetak', onClick: () => toast('Cetak', 'success') },
            { label: 'Batalkan pesanan', tone: 'danger', onClick: () => toast('Contoh saja', 'success') },
          ]}
          />
        </>
      )}
    />
  );
}

function SelectedGrid() {
  const [selected, setSelected] = useState(['2', '3']);
  return (
    <DataGrid
      title="Pesanan dipilih"
      columns={ORDER_COLUMNS.slice(0, 6)}
      rows={ORDERS.slice(0, 5)}
      selectable
      selected={selected}
      onSelectionChange={(ids) => setSelected(ids)}
      bulkActions={() => <Button variant="text" type="button">Setujui</Button>}
      rowActions={() => <IconButton label="Ubah" size="sm"><Icon name="edit" /></IconButton>}
    />
  );
}

// Server paging (meta + onPageChange) and server search, as the Sales lists do:
// rows are not clickable, the detail opens from the "Lihat detail" action.
function SalesGrid() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const matching = ORDERS.filter((row) => !search || `${row.number} ${row.customer}`.toLowerCase().includes(search.toLowerCase()));
  const rows = matching.slice((page - 1) * limit, page * limit);
  return (
    <DataGrid
      title="Customer (Sales)"
      exportName="galeri-sales"
      columns={ORDER_COLUMNS.slice(0, 7)}
      rows={rows}
      meta={{ page, limit, total: matching.length }}
      onPageChange={setPage}
      onPageSizeChange={(size) => { setLimit(size); setPage(1); }}
      search={search}
      onSearchChange={(value) => { setSearch(value); setPage(1); }}
      searchPlaceholder="Cari nomor SO atau customer"
      empty={search ? 'Tidak ada customer yang cocok' : 'Belum ada data'}
      rowActions={(row) => (
        <IconButton label="Lihat detail" size="sm" onClick={() => toast(`Detail ${row.number}`, 'success')}>
          <Icon name="visibility" />
        </IconButton>
      )}
    />
  );
}

function EditableGrid() {
  const [rows, setRows] = useState([
    { id: 1, name: 'Warehouse', code: 'WH', members: 12, active: true, createdAt: '2026-01-05T09:00:00+07:00' },
    { id: 2, name: 'Sales', code: 'SLS', members: 34, active: true, createdAt: '2026-01-05T09:00:00+07:00' },
    { id: 3, name: 'Procurement', code: 'PRC', members: 6, active: false, createdAt: '2026-02-11T13:30:00+07:00' },
  ]);
  return (
    <DataGrid
      title="Divisi"
      exportName="galeri-divisi"
      columns={[
        { key: 'name', header: 'Nama', required: true },
        { key: 'code', header: 'Kode', required: true, validate: (value) => (String(value).length > 4 ? 'Maksimal 4 huruf' : undefined) },
        { key: 'members', header: 'Anggota', type: 'number' },
        { key: 'active', header: 'Aktif', type: 'boolean' },
        { key: 'createdAt', header: 'Dibuat', type: 'datetime', editable: false },
      ]}
      rows={rows}
      canCreate
      canUpdate
      canDelete={(row) => !row.active}
      createLabel="Tambah divisi"
      onCreate={(payload) => setRows((current) => [...current, { ...payload, id: current.length + 1, createdAt: new Date().toISOString() }])}
      onUpdate={(row, payload) => setRows((current) => current.map((item) => (item.id === row.id ? { ...item, ...payload } : item)))}
      onDelete={(row) => setRows((current) => current.filter((item) => item.id !== row.id))}
    />
  );
}

function ErrorGrid() {
  const [failed, setFailed] = useState(true);
  return (
    <DataGrid
      title="Log integrasi"
      columns={ORDER_COLUMNS.slice(0, 4)}
      rows={failed ? [] : ORDERS.slice(0, 3)}
      error={failed ? 'Server tidak menjawab (504). Periksa koneksi, lalu coba lagi.' : ''}
      onRetry={() => setFailed(false)}
      searchable={false}
    />
  );
}

// A reload that fails while rows are shown: the rows stay under an error Banner.
function ReloadErrorGrid() {
  const [failed, setFailed] = useState(true);
  return (
    <DataGrid
      title="Pesanan penjualan"
      columns={ORDER_COLUMNS.slice(0, 4)}
      rows={ORDERS.slice(0, 5)}
      error={failed ? 'Server tidak menjawab (504). Data di bawah dari pemuatan sebelumnya.' : ''}
      onRetry={() => setFailed(false)}
      searchable={false}
    />
  );
}

function PagerDemo() {
  const [page, setPage] = useState(2);
  const [size, setSize] = useState(20);
  return <Pager page={page} pageCount={7} onPageChange={setPage} pageSize={size} pageSizes={[10, 20, 50, 100]} onPageSizeChange={setSize} />;
}

export default function GridGallery() {
  return (
    <div className="pw-stack">
      <Demo id="full" title="Daftar lengkap: judul, pencarian, bilah filter, ekspor, pilih baris, aksi baris, 30 baris">
        <FullGrid />
      </Demo>
      <Demo id="selected" title="Toolbar kontekstual (2 baris terpilih)">
        <SelectedGrid />
      </Demo>
      <Demo id="sales" title="Paging dan pencarian server, baris tidak bisa diklik (pengecualian Sales)">
        <SalesGrid />
      </Demo>
      <Demo id="editable" title="Ubah di tempat (tambah, ubah, hapus)">
        <EditableGrid />
      </Demo>
      <Demo id="empty" title="Kosong">
        <DataGrid title="Tiket IT" columns={ORDER_COLUMNS.slice(0, 4)} rows={[]} empty="Belum ada tiket masuk." />
      </Demo>
      <Demo id="error" title="Gagal memuat">
        <ErrorGrid />
      </Demo>
      <Demo id="loading" title="Memuat">
        <DataGrid title="Pesanan penjualan" columns={ORDER_COLUMNS} rows={[]} loading selectable rowActions={() => null} />
      </Demo>
      <Demo id="reload-error" title="Gagal memuat ulang (baris tetap tampil)">
        <ReloadErrorGrid />
      </Demo>
      <Demo id="pager" title="Pager mandiri">
        <PagerDemo />
      </Demo>
    </div>
  );
}
