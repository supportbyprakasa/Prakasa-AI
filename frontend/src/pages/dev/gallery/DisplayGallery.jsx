import { useRef, useState } from 'react';
import ActionMenu from '../../../components/ActionMenu';
import Badge from '../../../components/Badge';
import Banner from '../../../components/Banner';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ConfirmDialog from '../../../components/ConfirmDialog';
import CountBadge from '../../../components/CountBadge';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import FormActions from '../../../components/FormActions';
import FullScreenDialog, { FullScreenSection } from '../../../components/FullScreenDialog';
import Input from '../../../components/Input';
import KeyValue from '../../../components/KeyValue';
import Menu from '../../../components/Menu';
import Modal from '../../../components/Modal';
import PriorityBadge from '../../../components/PriorityBadge';
import ProgressBar from '../../../components/ProgressBar';
import Select from '../../../components/Select';
import SideSheet from '../../../components/SideSheet';
import { SkeletonCard, SkeletonTable } from '../../../components/Skeleton';
import Spinner from '../../../components/Spinner';
import StatCard from '../../../components/StatCard';
import StatusBadge from '../../../components/StatusBadge';
import { toast } from '../../../components/Toast';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty } from '../../../components/format';

// Overlays and display components (design work package C) in every state,
// for measuring against docs/ui-guideline.md §4.10–4.16. Every sample carries
// data-g="…" so the measuring script can find it.

const LONG = 'Data stok dari Accurate belum disetujui oleh Supervisor atau Head divisi, sehingga angka di halaman ini masih memakai batch yang disetujui kemarin sore pukul 16.40.';
const DIVISIONS = [
  { value: 'sales', label: 'Sales' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'finance', label: 'Finance' },
];
const MENU_ITEMS = [
  { label: 'Lihat detail', icon: 'visibility', onClick: () => toast('Membuka detail', 'info') },
  { label: 'Ubah', icon: 'edit', onClick: () => toast('Mode ubah', 'info') },
  { label: 'Duplikat (tidak tersedia)', icon: 'content_copy', disabled: true },
  { divider: true, key: 'd1' },
  { label: 'Hapus', icon: 'delete', tone: 'danger', onClick: () => toast('Dihapus', 'success') },
];

function Section({ title, children, id }) {
  return (
    <section className="pw-stack" data-g={`section-${id}`}>
      <h3 className="pw-title-section">{title}</h3>
      {children}
    </section>
  );
}

function Fields() {
  return (
    <div className="pw-form-grid">
      <Input label="Nama depan *" name="g-first" required />
      <Input label="Nama belakang" name="g-last" />
      <Input label="Email kerja *" name="g-email" type="email" required hint="Dipakai untuk masuk ke Google Workspace" />
      <Select label="Divisi" name="g-division" options={DIVISIONS} placeholder="Pilih divisi" />
      <Input label="Nomor telepon" name="g-phone" error="Nomor telepon belum lengkap" />
      <Input label="Tanggal mulai" name="g-start" type="date" />
    </div>
  );
}

export default function DisplayGallery() {
  const [dialog, setDialog] = useState(null);
  const [stacked, setStacked] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef(null);
  const close = () => { setDialog(null); setFsDirty(false); };
  // The full-screen form asks "Buang perubahan?" once a field was typed in.
  const [fsDirty, setFsDirty] = useState(false);

  return (
    <div className="pw-stack pw-stack--lg" data-g="display">
      <Section id="cards" title="Kartu dan panel">
        <div className="pw-cols-2">
          <Card
            data-g="card-default"
            title="Ringkasan hari ini"
            subtitle="Diperbarui 30 Sep 2026, 14.05"
            actions={<Button variant="text">Lihat semua</Button>}
          >
            <p className="pw-muted">Kartu bawaan: latar tint, radius 12, tanpa bayangan, padding 24.</p>
          </Card>
          <Card data-g="card-sm" size="sm" title="Judul bagian (size sm)">
            <p className="pw-muted">Judul bagian Roboto 18/24.</p>
          </Card>
          <Card data-g="card-panel" variant="panel" title="Panel putih" size="sm">
            <KeyValue items={[{ label: 'Pemilik', value: 'Divisi Sales' }, { label: 'Dibuat', value: formatDate('2026-09-30') }]} />
          </Card>
          <Card data-g="card-chart" variant="chart" title="Omzet per bulan">
            <div className="pw-stack">
              <ProgressBar value={62} label="Omzet bulan ini" />
              <p className="pw-muted">Kartu grafik: putih, radius 2, elevasi 2, padding 24 24 0.</p>
            </div>
          </Card>
          <Card data-g="card-flush" noPadding title="Tanpa padding (noPadding)">
            <SkeletonTable rows={2} columns={3} />
          </Card>
          <Card data-g="card-long" title="Judul kartu yang sangat panjang sekali untuk menguji pembungkusan teks di layar ponsel yang sempit" actions={<ActionMenu items={MENU_ITEMS} label="Aksi kartu" />}>
            <p>{LONG}</p>
          </Card>
        </div>
      </Section>

      <Section id="stats" title="Kartu statistik">
        <div className="pw-cols-4" data-g="stats">
          <StatCard label="Order hari ini" value={formatNumber(1738)} note="12 lebih banyak dari kemarin" />
          <StatCard label="Stok minus" value={formatNumber(138)} note="Perlu dicek di Accurate" alert />
          <StatCard label="Omzet (sebelum PPN)" value={formatMoney(104125000)} note="Bulan berjalan" />
          <StatCard label="Belum ada target" value={null} note="Target belum diatur" empty />
          <StatCard label="Memuat angka" loading />
          <StatCard label="Label statistik yang panjang sekali dan terus berlanjut" value="99+" note={LONG} />
        </div>
      </Section>

      <Section id="progress" title="Progres dan memuat">
        <div className="pw-stack" data-g="progress">
          <ProgressBar value={0} label="Belum mulai" />
          <ProgressBar value={45} label="Hampir separuh" />
          <ProgressBar value={100} label="Selesai" />
          <ProgressBar value={30} tone="error" label="Tertinggal" />
          <ProgressBar label="Sedang memuat" />
        </div>
        <div className="pw-row" data-g="spinners">
          <Spinner />
          <Spinner size="lg" />
        </div>
        <div className="pw-cols-2">
          <Card variant="panel" noPadding data-g="loading"><LoadingState label="Memuat laporan…" /></Card>
          <Card variant="panel" noPadding data-g="loading-compact"><LoadingState compact /></Card>
        </div>
      </Section>

      <Section id="status" title="Status, prioritas, hitungan">
        <div className="pw-row" data-g="status">
          <StatusBadge status="draft" />
          <StatusBadge status="in_progress" />
          <StatusBadge status="pending_approval" />
          <StatusBadge status="approved" />
          <StatusBadge status="rejected" />
          <StatusBadge status="investigating" />
          <StatusBadge status="needs_review" />
          <StatusBadge status="reorder_critical" />
          <StatusBadge status="kode_baru_tak_dikenal" />
        </div>
        <div className="pw-row" data-g="priority">
          <PriorityBadge priority="low" />
          <PriorityBadge priority="normal" />
          <PriorityBadge priority="high" />
          <PriorityBadge priority="urgent" />
          <PriorityBadge priority="critical" />
        </div>
        <div className="pw-row" data-g="badge">
          <Badge>Label netral</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="success">Berhasil</Badge>
          <Badge tone="warning">Peringatan</Badge>
          <Badge tone="error">Gagal</Badge>
        </div>
        <div className="pw-row" data-g="count">
          <CountBadge count={3} label="3 belum dibaca" />
          <CountBadge count={12} />
          <CountBadge count={120} />
          <CountBadge count={0} />
          <CountBadge dot label="Ada yang baru" />
          <CountBadge>Baru</CountBadge>
        </div>
      </Section>

      <Section id="banner" title="Banner">
        <div className="pw-stack" data-g="banners">
          <Banner tone="info">Data Accurate terakhir disetujui 30 Sep 2026, 13.40.</Banner>
          <Banner tone="success" title="Tersambung">Integrasi Accurate berjalan normal.</Banner>
          <Banner tone="warning" action={<Button variant="text">Tinjau batch</Button>}>Ada 37 perubahan menunggu persetujuan.</Banner>
          <Banner tone="error" title="Sinkron gagal" action={<Button variant="text">Coba lagi</Button>}>{LONG}</Banner>
          <Banner tone="neutral">Halaman ini hanya bisa dibaca.</Banner>
        </div>
      </Section>

      <Section id="kv" title="Pasangan label dan nilai">
        <div className="pw-cols-2">
          <Card variant="panel" data-g="kv-1">
            <KeyValue items={[
              { label: 'Nomor', value: 'SO68/HRC-PFN/IX/2026' },
              { label: 'Customer', value: 'Big House Cafe' },
              { label: 'Total', value: formatMoney(12500000) },
              { label: 'Catatan', value: '' },
            ]}
            />
          </Card>
          <Card variant="panel" data-g="kv-2">
            <KeyValue
              columns={2}
              items={[
                { label: 'Tanggal', value: formatDate('2026-09-30') },
                { label: 'Jam', value: formatDateTime('2026-09-30T07:05:00Z') },
                { label: 'Jumlah', value: formatQty(1234.5, 'Ctns') },
                { label: 'Kosong', value: null },
              ]}
            />
          </Card>
        </div>
      </Section>

      <Section id="empty" title="Kosong, gagal, dan skeleton">
        <div className="pw-cols-2">
          <Card variant="panel" noPadding data-g="empty">
            <EmptyState icon="inbox" title="Belum ada data" description="Data baru muncul di sini setelah dibuat." action={<Button>Tambah data</Button>} />
          </Card>
          <Card variant="panel" noPadding data-g="empty-error">
            <EmptyState tone="error" title="Data gagal dimuat" description="Periksa koneksi lalu coba lagi." action={<Button variant="secondary">Coba lagi</Button>} />
          </Card>
          <Card variant="panel" noPadding data-g="empty-compact">
            <EmptyState compact icon="search_off" title="Tidak ada hasil" description="Ubah kata kunci pencarian." />
          </Card>
          <div data-g="skeleton-card"><SkeletonCard lines={3} /></div>
        </div>
        <div data-g="skeleton-table"><SkeletonTable rows={3} columns={5} framed /></div>
      </Section>

      <Section id="actions" title="Aksi form">
        <Card variant="panel" data-g="form-actions">
          <div className="pw-stack">
            <FormActions>
              <Button variant="text">Batal</Button>
              <Button>Simpan</Button>
            </FormActions>
            <FormActions align="between">
              <Button variant="text">Hapus draf</Button>
              <Button>Kirim</Button>
            </FormActions>
          </div>
        </Card>
      </Section>

      <Section id="overlays" title="Dialog, side sheet, menu, snackbar">
        <div className="pw-row" data-g="overlay-triggers">
          <Button variant="secondary" data-g="open-sm" onClick={() => setDialog('sm')}>Dialog kecil</Button>
          <Button variant="secondary" data-g="open-md" onClick={() => setDialog('md')}>Dialog form</Button>
          <Button variant="secondary" data-g="open-lg" onClick={() => setDialog('lg')}>Modal size lg</Button>
          <Button variant="secondary" data-g="open-full" onClick={() => setDialog('full')}>Dialog layar penuh</Button>
          <Button variant="secondary" data-g="open-confirm" onClick={() => setDialog('confirm')}>Konfirmasi hapus</Button>
          <Button variant="secondary" data-g="open-confirm-primary" onClick={() => setDialog('confirm-primary')}>Konfirmasi biasa</Button>
          <Button variant="secondary" data-g="open-sheet" onClick={() => setDialog('sheet')}>Side sheet</Button>
          <span ref={menuAnchor} className="pw-row">
            <Button variant="secondary" data-g="open-menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>Menu</Button>
          </span>
          <ActionMenu items={MENU_ITEMS} label="Aksi baris" />
        </div>
        <div className="pw-row" data-g="toast-triggers">
          <Button variant="text" data-g="toast-success" onClick={() => toast('Perubahan tersimpan', 'success')}>Snackbar berhasil</Button>
          <Button variant="text" data-g="toast-error" onClick={() => toast('Data gagal dihapus. Coba lagi beberapa saat lagi.', 'error')}>Snackbar gagal</Button>
          <Button variant="text" data-g="toast-action" onClick={() => toast('Dokumen dipindah ke sampah', 'info', { action: { label: 'Urungkan', onClick: () => toast('Dokumen dikembalikan', 'success') } })}>Snackbar dengan aksi</Button>
          <Button variant="text" data-g="toast-long" onClick={() => toast(LONG, 'info')}>Snackbar panjang</Button>
        </div>
        <Menu open={menuOpen} anchorRef={menuAnchor} onClose={() => setMenuOpen(false)} align="start" label="Menu contoh" items={MENU_ITEMS} />
      </Section>

      <Modal open={dialog === 'sm'} onClose={close} size="sm" title="Kirim ulang undangan?" footer={<><Button variant="text" onClick={close}>Batal</Button><Button onClick={close}>Kirim</Button></>}>
        <p className="pw-muted">Undangan dikirim ulang ke alamat email kerja pengguna.</p>
      </Modal>

      <Modal open={dialog === 'md'} onClose={close} title="Tambah catatan" footer={<><Button variant="text" onClick={close}>Batal</Button><Button onClick={() => setStacked(true)}>Simpan</Button></>}>
        <div className="pw-stack">
          <Input label="Judul catatan *" name="g-note-title" required />
          <Select label="Divisi" name="g-note-division" options={DIVISIONS} placeholder="Pilih divisi" />
          <Input label="Isi catatan" name="g-note-body" hint="Paling banyak 500 karakter" />
        </div>
      </Modal>

      <ConfirmDialog
        open={stacked}
        tone="primary"
        title="Simpan catatan?"
        message="Dialog ini bertumpuk di atas dialog form. Escape menutup yang paling atas saja."
        confirmLabel="Simpan"
        onConfirm={() => { setStacked(false); close(); toast('Catatan tersimpan', 'success'); }}
        onClose={() => setStacked(false)}
      />

      <Modal open={dialog === 'lg'} onClose={close} size="lg" title="Tambah pengguna" footer={<><Button variant="text" onClick={close}>Batal</Button><Button onClick={close}>Tambah pengguna</Button></>}>
        <Fields />
      </Modal>

      <FullScreenDialog
        open={dialog === 'full'}
        onClose={close}
        title="Tambah pengguna baru"
        card={false}
        dirty={fsDirty}
        actions={<><Button variant="text" onClick={close}>Batal</Button><Button onClick={close}>Tambah pengguna</Button></>}
      >
        <FullScreenSection title="Informasi pengguna">
          <div className="pw-fsdialog__fields">
            <Input label="Nama depan *" name="g-fs-first" required onChange={() => setFsDirty(true)} />
            <Input label="Nama belakang *" name="g-fs-last" required />
            <Input label="Email utama *" name="g-fs-email" type="email" required />
            <Input label="Email sekunder" name="g-fs-email2" type="email" />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Divisi dan peran">
          <div className="pw-fsdialog__fields">
            <Select label="Divisi" name="g-fs-division" options={DIVISIONS} placeholder="Pilih divisi" />
            <Select label="Peran" name="g-fs-role" options={[{ value: 'staff', label: 'Staf' }, { value: 'supervisor', label: 'Supervisor' }]} placeholder="Pilih peran" />
          </div>
        </FullScreenSection>
      </FullScreenDialog>

      <ConfirmDialog
        open={dialog === 'confirm'}
        title="Hapus data ini?"
        message={'Data yang dihapus tidak bisa dikembalikan.\nTekan "Hapus" untuk mencoba — hasilnya gagal, dan snackbar gagal harus tampil di atas dialog ini.'}
        confirmLabel="Hapus"
        loading={confirmLoading}
        onConfirm={() => {
          setConfirmLoading(true);
          window.setTimeout(() => {
            setConfirmLoading(false);
            toast('Data gagal dihapus. Server menolak permintaan.', 'error');
          }, 600);
        }}
        onClose={close}
      />

      <ConfirmDialog
        open={dialog === 'confirm-primary'}
        tone="primary"
        title="Setujui batch Accurate?"
        message="37 perubahan stok akan dipakai di semua halaman Warehouse."
        confirmLabel="Setujui"
        onConfirm={() => { close(); toast('Batch disetujui', 'success'); }}
        onClose={close}
      />

      <SideSheet
        open={dialog === 'sheet'}
        onClose={close}
        title="Detail pergerakan"
        footer={<><Button variant="text" onClick={close}>Tutup</Button><Button onClick={close}>Simpan</Button></>}
      >
        <div className="pw-stack">
          <KeyValue items={[
            { label: 'Nomor', value: 'IT.2026.09.00017' },
            { label: 'Dari', value: 'WH Royal Kosambi' },
            { label: 'Ke', value: 'WH Alam Sutera' },
            { label: 'Status', value: <StatusBadge status="in_transit" /> },
          ]}
          />
          <Input label="Catatan penerimaan" name="g-sheet-note" />
          <p className="pw-muted">{LONG}</p>
        </div>
      </SideSheet>
    </div>
  );
}
