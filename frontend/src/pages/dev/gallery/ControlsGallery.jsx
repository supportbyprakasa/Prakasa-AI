import { useState } from 'react';
import Button from '../../../components/Button';
import Icon from '../../../components/Icon';
import IconButton from '../../../components/IconButton';
import Chip from '../../../components/Chip';
import Segmented from '../../../components/Segmented';
import TabBar from '../../../components/TabBar';
import Input from '../../../components/Input';
import Select from '../../../components/Select';
import Textarea from '../../../components/Textarea';
import DateInput from '../../../components/DateInput';
import Field from '../../../components/Field';
import SearchField from '../../../components/SearchField';
import Checkbox from '../../../components/Checkbox';
import Radio from '../../../components/Radio';
import Switch from '../../../components/Switch';
import { RoleSelect, UserSelect } from '../../../components/UserRoleSelects';

// Controls design work package: every control in every state, measured
// against docs/ui-guideline.md §4.1–4.8 and §4.14 (data-m marks the
// elements the measurement script reads).
const STATUS = [{ value: 'aktif', label: 'Aktif' }, { value: 'nonaktif', label: 'Nonaktif' }];
const LONG = 'Label yang sangat panjang untuk menguji pemotongan teks di layar sempit';

function Block({ title, children }) {
  return (
    <div className="pw-stack pw-stack--sm">
      <h3 className="pw-title-section">{title}</h3>
      {children}
    </div>
  );
}

export default function ControlsGallery() {
  const [text, setText] = useState('Budi Santoso');
  const [status, setStatus] = useState('aktif');
  const [search, setSearch] = useState('laporan');
  const [checks, setChecks] = useState({ a: true, b: false });
  const [radio, setRadio] = useState('harian');
  const [toggle, setToggle] = useState(true);
  const [chip, setChip] = useState('semua');
  const [view, setView] = useState('papan');
  const [days, setDays] = useState(['sen', 'rab']);
  const [tab, setTab] = useState('ringkasan');
  const [tab2, setTab2] = useState('masuk');
  const [user, setUser] = useState('');

  return (
    <div className="pw-stack pw-stack--lg" data-m="controls">
      <Block title="Tombol">
        <div className="pw-row">
          <Button data-m="btn-primary">Simpan</Button>
          <Button variant="secondary" data-m="btn-secondary">Ekspor</Button>
          <Button variant="text" data-m="btn-text">Batal</Button>
          <Button variant="tonal" data-m="btn-tonal">Terpilih</Button>
          <Button variant="danger" data-m="btn-danger">Hapus</Button>
        </div>
        <div className="pw-row">
          <Button icon="add" data-m="btn-icon">Tambah pengguna</Button>
          <Button variant="secondary" icon="download">Unduh</Button>
          <Button variant="text" icon="refresh" data-m="btn-text-icon">Muat ulang</Button>
          <Button variant="tonal"><Icon name="add" size="sm" /> Ikon sebagai anak</Button>
          <Button variant="danger" icon={<Icon name="delete" size="sm" />}>Hapus data</Button>
        </div>
        <div className="pw-row">
          <Button disabled data-m="btn-disabled">Simpan</Button>
          <Button variant="secondary" disabled>Ekspor</Button>
          <Button variant="text" disabled>Batal</Button>
          <Button loading data-m="btn-loading">Simpan perubahan</Button>
          <Button variant="secondary" loading>Ekspor</Button>
          <Button to="/__design" variant="text" data-m="btn-link">Tautan tombol</Button>
          <Button variant="secondary" tooltip="Unduh semua baris sebagai .xlsx" data-m="btn-tooltip">Dengan tooltip</Button>
          <Button variant="secondary" disabled title="Buat surat jalan dulu" data-m="btn-disabled-title">Nonaktif dengan title</Button>
        </div>
        <div className="pw-row">
          <Button block>{LONG}</Button>
        </div>
      </Block>

      <Block title="Tombol ikon">
        <div className="pw-row">
          <IconButton label="Tambah" icon="add" data-m="ib-md" />
          <IconButton label="Filter" icon="filter_list" size="sm" data-m="ib-sm" />
          <IconButton label="Hapus" icon="delete" tone="danger" />
          <IconButton label="Edit" icon="edit" tone="primary" />
          <IconButton label="Tampilan kisi" icon="grid_view" selected data-m="ib-selected" />
          <IconButton label="Tampilan daftar" icon="view_list" selected={false} />
          <IconButton label="Notifikasi, 3 baru" icon="notifications" badge={3} data-m="ib-badge" />
          <IconButton label="Tugas, ada yang baru" icon="task_alt" badge />
          <IconButton label="Kirim" icon="send" variant="filled" data-m="ib-filled" />
          <IconButton label="Tidak tersedia" icon="block" disabled data-m="ib-disabled" />
          <IconButton label="Ikon sebagai anak"><Icon name="more_vert" /></IconButton>
          <IconButton label="Buka galeri" icon="open_in_new" to="/__design" size="sm" />
        </div>
      </Block>

      <Block title="Field">
        <div className="pw-form-grid">
          <Input label="Nama lengkap" value={text} onChange={(e) => setText(e.target.value)} required data-m="field-filled" />
          <Input label="Email" type="email" data-m="field-empty" />
          <Input label="Kota" placeholder="mis. Jakarta" hint="Placeholder tampil saat fokus." data-m="field-hint" />
          <Input label="Nomor telepon" error="Nomor telepon wajib diisi." required data-m="field-error" />
          <Input label="Kode akun" value="ACC-0001" mono readOnly />
          <Input label="Tidak aktif" value="Tidak bisa diubah" disabled data-m="field-disabled" />
          <Input label="Jumlah" type="number" defaultValue={12} />
          <DateInput label="Tanggal mulai" data-m="field-date" />
          <DateInput label="Jam" type="time" defaultValue="09:30" />
          <Input label="Bulan" type="month" />
          <Input label="Lampiran" type="file" />
          <Input label={LONG} />
        </div>
        <div className="pw-form-grid">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS} data-m="select-filled" />
          <Select label="Divisi" placeholder="Semua" options={STATUS} data-m="select-placeholder" />
          <Select label="Kosong" placeholder="" options={STATUS} data-m="select-empty" />
          <Select label="Prioritas" error="Pilih prioritas." options={STATUS} placeholder="" required />
          <Select label="Nonaktif" options={STATUS} disabled />
          <UserSelect label="Penanggung jawab" value={user} onChange={setUser} users={[{ id: 1, name: 'Budi' }, { id: 2, name: 'Sari' }]} />
          <RoleSelect label="Peran" roles={[{ id: 1, name: 'Admin' }]} onChange={() => {}} />
        </div>
        <div className="pw-form-grid">
          <Textarea label="Catatan" rows={3} data-m="textarea" />
          <Textarea label="Deskripsi" rows={3} defaultValue={'Baris pertama\nBaris kedua'} hint="Maksimum 500 karakter." />
          <Field label="Hari kerja" hint="Pilih satu atau lebih.">
            <div className="pw-row">
              <Checkbox label="Senin" defaultChecked />
              <Checkbox label="Selasa" />
            </div>
          </Field>
        </div>
        <div className="pw-row">
          <Input aria-label="Tanpa label" placeholder="Field tanpa label (36px)" data-m="field-bare" />
          <Input label="Sel tabel" dense defaultValue="12" data-m="field-dense" />
          <Select label="Baris per halaman" dense options={[{ value: 25, label: '25' }, { value: 50, label: '50' }]} data-m="select-dense" />
        </div>
      </Block>

      <Block title="Pencarian">
        <SearchField placeholder="Cari pengguna atau grup" value={search} onChange={(e) => setSearch(e.target.value)} data-m="search" />
        <SearchField placeholder="Cari di tabel" />
        <SearchField placeholder="Pencarian nonaktif" disabled />
      </Block>

      <Block title="Checkbox, radio, switch">
        <div className="pw-row">
          <Checkbox label="Tercentang" checked={checks.a} onChange={(e) => setChecks({ ...checks, a: e.target.checked })} data-m="cb-checked" />
          <Checkbox label="Belum" checked={checks.b} onChange={(e) => setChecks({ ...checks, b: e.target.checked })} data-m="cb-unchecked" />
          <Checkbox label="Sebagian" indeterminate readOnly />
          <Checkbox label="Nonaktif" disabled />
          <Checkbox label="Nonaktif tercentang" disabled defaultChecked />
          <Checkbox aria-label="Pilih baris" />
        </div>
        <div className="pw-row" role="radiogroup" aria-label="Frekuensi">
          <Radio name="freq" value="harian" label="Harian" checked={radio === 'harian'} onChange={() => setRadio('harian')} data-m="radio-checked" />
          <Radio name="freq" value="mingguan" label="Mingguan" checked={radio === 'mingguan'} onChange={() => setRadio('mingguan')} data-m="radio-unchecked" />
          <Radio name="freq2" value="x" label="Nonaktif" disabled />
        </div>
        <div className="pw-row">
          <Switch label="Notifikasi email" checked={toggle} onChange={(e) => setToggle(e.target.checked)} data-m="switch" />
          <Switch label="Mati" data-m="switch-off" />
          <Switch label="Nonaktif" disabled />
          <Checkbox label={LONG} />
        </div>
      </Block>

      <Block title="Chip">
        <div className="pw-row">
          {['semua', 'menunggu', 'selesai'].map((key) => (
            <Chip key={key} selected={chip === key} onClick={() => setChip(key)} data-m={`chip-${key}`}>
              {key === 'semua' ? 'Semua' : key === 'menunggu' ? 'Menunggu (3)' : 'Selesai'}
            </Chip>
          ))}
          <Chip icon="person" selected={false}>Dengan ikon</Chip>
          <Chip disabled>Nonaktif</Chip>
          <Chip variant="add" data-m="chip-add">Tambah filter</Chip>
          <Chip tooltip="Pesanan yang belum dikirim">Dengan tooltip</Chip>
          <Chip selected>{LONG}</Chip>
        </div>
      </Block>

      <Block title="Segmented">
        <Segmented label="Tampilan" value={view} onChange={setView} options={[{ value: 'papan', label: 'Papan' }, { value: 'daftar', label: 'Daftar' }]} />
        <Segmented label="Hari" multiple value={days} onChange={setDays} options={[{ value: 'sen', label: 'Sen' }, { value: 'sel', label: 'Sel' }, { value: 'rab', label: 'Rab' }, { value: 'kam', label: 'Kam', disabled: true }]} />
        <Segmented label="Tata letak" value="kisi" options={[{ value: 'kisi', label: 'Kisi', icon: 'grid_view' }, { value: 'baris', label: 'Baris', icon: 'view_list' }]} />
      </Block>

      <Block title="Tab">
        <TabBar
          label="Contoh tab"
          idPrefix="g-tab"
          panelId="g-tab-panel"
          value={tab}
          onChange={setTab}
          tabs={[{ k: 'ringkasan', l: 'Ringkasan' }, { k: 'anggota', l: 'Anggota' }, { k: 'setelan', l: 'Setelan' }, { k: 'arsip', l: 'Arsip', disabled: true }]}
        />
        <div id="g-tab-panel" role="tabpanel" aria-labelledby={`g-tab-${tab}`} className="pw-muted">Panel: {tab}</div>
        <TabBar
          label="Tab dengan ikon dan hitungan"
          idPrefix="g-tab2"
          value={tab2}
          onChange={setTab2}
          tabs={[
            { k: 'masuk', l: 'Masuk', icon: 'inbox', count: 12 },
            { k: 'dikirim', l: 'Dikirim', icon: 'send' },
            { k: 'draf', l: 'Draf', icon: 'draft', count: 3 },
            { k: 'arsip', l: 'Arsip', icon: 'archive' },
            { k: 'sampah', l: 'Sampah', icon: 'delete' },
            { k: 'spam', l: 'Spam', icon: 'report' },
          ]}
        />
      </Block>
    </div>
  );
}
