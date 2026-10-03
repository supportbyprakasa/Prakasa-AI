import { useState } from 'react';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormActions from '../../components/FormActions';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import Segmented from '../../components/Segmented';
import Switch from '../../components/Switch';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { saveAccountLanguage } from '../../i18n/accountLanguage.js';
import { getLanguage, setLanguage } from '../../i18n/language.js';
import { LANGUAGE_OPTIONS, googleOnly, roleNames, signInMethods } from './accountModel';
import './account.css';

// Akun saya (/akun): what the signed-in user may see and set about their own
// account — profile (read-only), interface language, who manages the
// password (read-only), sessions.
// Personal HR data (salary, bank, identity numbers) lives in the HRIS and is
// never shown here.
export default function Account() {
  const { user } = useAuth();
  return (
    <Page title="Akun saya" description="Profil, bahasa tampilan, beranda, dan sesi akun Anda.">
      <ProfileCard user={user} />
      <LanguageCard />
      <HomeCard user={user} />
      <PasswordCard user={user} />
      <SessionCard />
    </Page>
  );
}

function ProfileCard({ user }) {
  const roles = roleNames(user);
  const methods = signInMethods(user);
  const items = [
    { label: 'Nama', value: user?.name },
    { label: 'Email kerja', value: user?.email },
    { label: 'Divisi', value: user?.departmentName },
    { label: 'Peran', value: roles.join(', ') },
    // Interface labels, not record data: translated.
    { label: 'Cara masuk', parts: methods.length ? methods : null, separator: ', ' },
  ];
  return (
    <Card title="Profil" variant="panel" size="sm">
      <div className="pw-stack">
        <KeyValue items={items} columns={2} />
        <p className="account-text">
          Nama, divisi, dan peran diatur oleh Administrator dan disinkronkan dari Google Workspace. Hubungi Administrator Sistem bila ada yang perlu diubah.
        </p>
      </div>
    </Card>
  );
}

function LanguageCard() {
  const language = getLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const choose = async (next) => {
    if (saving || next === language) return;
    setSaving(true); setError('');
    try {
      await saveAccountLanguage(next);
    } catch {
      setSaving(false);
      setError('Bahasa belum tersimpan di akun Anda. Periksa koneksi lalu coba lagi.');
      return;
    }
    // Reloads the page in the chosen language.
    setLanguage(next);
  };

  return (
    <Card title="Bahasa" variant="panel" size="sm">
      <div className="pw-stack">
        {error ? <Banner tone="error">{error}</Banner> : null}
        <p className="account-text">
          Bahasa tampilan aplikasi. Pilihan ini disimpan di akun Anda, jadi ikut dipakai saat Anda masuk dari perangkat lain.
        </p>
        <div>
          <Segmented label="Bahasa tampilan" options={LANGUAGE_OPTIONS} value={language} onChange={choose} />
        </div>
        <p className="account-text">
          Data dari Accurate dan teks yang diketik pengguna tidak diterjemahkan.
        </p>
      </div>
    </Card>
  );
}

// Beranda: whether the home page shows the "Ringkasan pagi" card. Saved on the
// account (PATCH /auth/me/preferences), so it follows the user to another browser.
function HomeCard({ user }) {
  const { refreshUser } = useAuth();
  const [shown, setShown] = useState(user?.morningBriefing !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const change = async (event) => {
    const next = event.target.checked;
    setShown(next); setSaving(true); setError('');
    try {
      await api.patch('/auth/me/preferences', { morningBriefing: next });
      await refreshUser();
    } catch {
      setShown(!next);
      setError('Pilihan belum tersimpan di akun Anda. Periksa koneksi lalu coba lagi.');
    } finally { setSaving(false); }
  };

  return (
    <Card title="Beranda" variant="panel" size="sm">
      <div className="pw-stack">
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Switch label="Tampilkan ringkasan pagi di beranda" checked={shown} disabled={saving} onChange={change} />
        <p className="account-text">
          Ringkasan pagi merangkum yang perlu Anda tindak hari ini: tugas, persetujuan, dan angka modul sesuai peran Anda.
          Disusun langsung dari data, tanpa model AI; tidak ada notifikasi atau email yang dikirim.
        </p>
      </div>
    </Card>
  );
}

// Read-only: passwords are managed by the Super Admin (owner decision,
// 2 Oct 2026). There is no self-service change or recovery; a temporary
// password is replaced on its own page right after sign-in.
function PasswordCard({ user }) {
  return (
    <Card title="Kata sandi" variant="panel" size="sm">
      <p className="account-text">
        {googleOnly(user)
          ? 'Anda masuk dengan Google; tidak perlu kata sandi.'
          : 'Kata sandi akun Anda dikelola oleh Super Admin. Untuk mengganti atau memulihkannya, hubungi Super Admin.'}
      </p>
    </Card>
  );
}

function SessionCard() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    // Ends every session of this account, then opens the sign-in page.
    await logout();
  };

  return (
    <Card title="Sesi" variant="panel" size="sm">
      <div className="pw-stack">
        <p className="account-text">
          Akun Anda dikeluarkan dari semua browser dan perangkat, termasuk yang ini. Pakai bila perangkat hilang atau Anda lupa keluar di komputer lain.
        </p>
        <FormActions align="start">
          <Button variant="secondary" icon="logout" onClick={() => setConfirming(true)}>Keluar dari semua perangkat</Button>
        </FormActions>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Keluar dari semua perangkat?"
        message="Semua sesi akun Anda berakhir, termasuk di perangkat ini. Anda perlu masuk lagi untuk melanjutkan."
        confirmLabel="Keluar dari semua perangkat"
        loading={leaving}
        onConfirm={leave}
        onClose={() => setConfirming(false)}
      />
    </Card>
  );
}
