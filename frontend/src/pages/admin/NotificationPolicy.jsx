import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Chip from '../../components/Chip';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import Switch from '../../components/Switch';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;

// Notifikasi & email: every notification the app sends, whether it shows in
// the app, and whether it also emails (backend/src/config/notificationPolicy.js).
// The administrator switches email per notification; "Bawaan" means the
// policy's own choice is in force.
export default function NotificationPolicy() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      setRows((await api.get('/notifications/policy')).data.data || []);
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (row, email) => {
    setSaving(row.event);
    try {
      const r = await api.put(`/notifications/policy/${encodeURIComponent(row.event)}`, { email });
      setRows((list) => list.map((x) => (x.event === row.event ? r.data.data : x)));
      toast(email === null ? 'Kembali ke bawaan' : (email ? 'Email dinyalakan' : 'Email dimatikan'), 'success');
    } catch (error) {
      toast(errorMessage(error, 'Pengaturan gagal disimpan'), 'error');
    } finally {
      setSaving('');
    }
  };

  const counts = {
    email: rows.filter((r) => r.email).length,
    app: rows.filter((r) => r.inApp && !r.email).length,
    off: rows.filter((r) => !r.inApp).length,
  };
  const visible = rows.filter((r) => (filter === 'email' ? r.email : filter === 'app' ? r.inApp && !r.email : filter === 'off' ? !r.inApp : true));

  return (
    <Page title="Notifikasi & email" description="Notifikasi apa yang muncul di aplikasi dan mana yang juga dikirim ke email, untuk semua fitur semua divisi.">
      <Banner tone="info" title="Aturannya">
        Di aplikasi: semua yang menyangkut pekerjaan atau permintaan Anda sendiri. Email: hanya yang menunggu keputusan atau tindakan dan terlambat itu merugikan — approval, tanda tangan, data Accurate menunggu persetujuan, tenggat onboarding/offboarding, aset belum kembali, pembayaran. Perubahan kecil yang sudah terlihat di Project Tracker dan Space tidak dikirim.
      </Banner>
      <DataGrid
        title="Notifikasi"
        showTitle={false}
        rows={visible}
        loading={loading}
        error={loadError}
        onRetry={load}
        idKey="event"
        searchPlaceholder="Cari notifikasi atau modul"
        filters={rows.length ? (
          <>
            <Chip selected={!filter} onClick={() => setFilter('')}>{`Semua (${formatNumber(rows.length)})`}</Chip>
            <Chip selected={filter === 'email'} onClick={() => setFilter(filter === 'email' ? '' : 'email')}>{`Aplikasi + email (${formatNumber(counts.email)})`}</Chip>
            <Chip selected={filter === 'app'} onClick={() => setFilter(filter === 'app' ? '' : 'app')}>{`Aplikasi saja (${formatNumber(counts.app)})`}</Chip>
            <Chip selected={filter === 'off'} onClick={() => setFilter(filter === 'off' ? '' : 'off')}>{`Tidak dikirim (${formatNumber(counts.off)})`}</Chip>
          </>
        ) : undefined}
        empty="Tidak ada notifikasi yang cocok"
        columns={[
          { key: 'group', header: 'Modul', translate: true },
          {
            key: 'description', header: 'Notifikasi', translate: true,
            render: (r) => (
              <span className="pw-cell">
                <span>{r.description}</span>
                <span data-no-translate="" className="pw-cell__meta">{r.event}</span>
              </span>
            ),
          },
          {
            key: 'inApp', header: 'Di aplikasi', nowrap: true,
            render: (r) => <StatusBadge status={r.inApp ? 'active' : 'inactive'} label={r.inApp ? 'Ya' : 'Tidak dikirim'} />,
            sortValue: (r) => (r.inApp ? 0 : 1), exportValue: (r) => (r.inApp ? 'Ya' : 'Tidak'),
          },
          {
            key: 'email', header: 'Email', nowrap: true, translate: true,
            render: (r) => (r.inApp ? (
              <span className="pw-row pw-row--nowrap">
                <Switch
                  label={r.emailOverride === null ? 'Bawaan' : 'Diubah admin'}
                  checked={Boolean(r.email)}
                  disabled={saving === r.event}
                  onChange={(e) => save(r, e.target.checked)}
                />
              </span>
            ) : '—'),
            sortValue: (r) => (r.email ? 0 : 1), exportValue: (r) => (r.email ? 'Ya' : 'Tidak'),
          },
        ]}
        rowActions={(r) => (r.emailOverride !== null ? <Chip onClick={() => save(r, null)}>Kembalikan bawaan</Chip> : null)}
      />
    </Page>
  );
}
