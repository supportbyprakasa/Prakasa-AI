import { GoogleLogin } from '@react-oauth/google';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { loginWithToken } = useAuth();

  const onSuccess = async (credentialResponse) => {
    const r = await api.post('/auth/google', { idToken: credentialResponse.credential });
    await loginWithToken(r.data.data.token);
    location.href = '/';
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: 'var(--color-background)'
    }}>
      <div style={{
        background: 'var(--color-surface)', padding: 40, borderRadius: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,.06)', textAlign: 'center', minWidth: 320
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>Prakasa AI Work OS</h1>
        <p style={{ margin: '0 0 24px', color: 'var(--color-text-muted)' }}>
          Masuk menggunakan akun Google Workspace
        </p>
        <GoogleLogin onSuccess={onSuccess} onError={() => alert('Login gagal')} />
      </div>
    </div>
  );
}
