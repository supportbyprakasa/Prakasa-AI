import { useState } from 'react';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { LoginShell } from './Login';

// Authenticated, but no division role usable for this account yet. Deliberately shows
// no workspace navigation so an unprovisioned user never lands on an open dashboard.
export default function AccessNotReady() {
  const { user, refreshUser, logout } = useAuth();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try { await refreshUser(); } catch { /* the gate re-renders from the latest state */ } finally { setChecking(false); }
  };

  return (
    <LoginShell>
      <span className="pw-login__status-icon" aria-hidden="true"><Icon name="gpp_maybe" /></span>
      <h2 className="pw-login__title">Akses belum disiapkan</h2>
      <p className="pw-login__subtitle">
        Anda sudah masuk sebagai <span data-no-translate="" className="pw-strong">{user?.email}</span>, tetapi akun ini belum memiliki divisi
        dan role yang aktif. Minta Super Admin menetapkan divisi dan role Anda, lalu periksa lagi.
      </p>
      <div className="pw-login__actions">
        <Button variant="text" onClick={logout}>Keluar</Button>
        <Button onClick={checkAgain} loading={checking}>Periksa lagi</Button>
      </div>
    </LoginShell>
  );
}
