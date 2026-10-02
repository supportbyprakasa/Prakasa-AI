import { useState } from 'react';
import api from '../api/client';
import Banner from '../components/Banner';
import Button from '../components/Button';
import Icon from '../components/Icon';
import Input from '../components/Input';
import { useAuth } from '../context/AuthContext';
import { LoginShell } from './Login';
import { passwordErrors } from './login/loginModel';

// Signed in with a temporary password a Super Admin set (the only password
// change left to the user: passwords are managed by the Super Admin): it must be
// replaced before anything else (the API refuses other calls meanwhile).
// Google sign-in never lands here.
export default function ChangePasswordRequired() {
  const { user, loginWithToken, logout } = useAuth();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (name) => (e) => { setValues((v) => ({ ...v, [name]: e.target.value })); setErrors((x) => ({ ...x, [name]: undefined })); };
  const submit = async (event) => {
    event.preventDefault();
    const found = passwordErrors(values, user?.email);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const r = await api.post('/auth/change-password', { currentPassword: values.currentPassword, newPassword: values.newPassword });
      await loginWithToken(r.data.data.token);
    } catch (error) {
      const err = error?.response?.data?.error || {};
      if (err.details?.field) setErrors((x) => ({ ...x, [err.details.field]: err.message }));
      else setFormError(err.message || 'Kata sandi gagal diganti. Coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <LoginShell>
      <span className="pw-login__status-icon" aria-hidden="true"><Icon name="password" /></span>
      <h2 className="pw-login__title">Ganti kata sandi sementara</h2>
      <p className="pw-login__subtitle">
        Anda masuk sebagai <span data-no-translate="" className="pw-strong">{user?.email}</span> dengan kata sandi sementara dari Super Admin. Buat kata sandi Anda sendiri untuk melanjutkan.
      </p>
      <form className="pw-stack" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        <Input label="Kata sandi saat ini" type="password" autoComplete="current-password" value={values.currentPassword} error={errors.currentPassword} onChange={set('currentPassword')} />
        <Input label="Kata sandi baru" type="password" autoComplete="new-password" value={values.newPassword} error={errors.newPassword} onChange={set('newPassword')} hint="Minimal 10 karakter, memuat huruf dan angka" />
        <Input label="Ulangi kata sandi baru" type="password" autoComplete="new-password" value={values.confirm} error={errors.confirm} onChange={set('confirm')} />
        <div className="pw-login__actions">
          <Button variant="text" type="button" onClick={logout}>Keluar</Button>
          <Button type="submit" loading={saving}>Simpan kata sandi</Button>
        </div>
      </form>
    </LoginShell>
  );
}
