import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { loginWithToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const googleEnabled =
    import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true' &&
    Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const finishLogin = async (token) => {
    await loginWithToken(token);
    location.href = '/';
  };

  const onManualSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await api.post('/auth/login', { email, password });
      await finishLogin(response.data.data.token);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          'Login gagal. Periksa email dan password.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleSuccess = async (credentialResponse) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post('/auth/google', {
        idToken: credentialResponse.credential,
      });
      await finishLogin(response.data.data.token);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          'Login Google gagal.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 14,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-background)',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 390,
          background: 'var(--color-surface)',
          padding: 32,
          borderRadius: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,.06)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>Prakasa AI Work OS</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
            Masuk menggunakan akun yang diberikan oleh administrator
          </p>
        </div>

        <form onSubmit={onManualSubmit}>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
            style={inputStyle}
            placeholder="nama@prakasagroup.com"
          />

          <label
            style={{
              display: 'block',
              fontSize: 13,
              marginTop: 14,
              marginBottom: 6,
            }}
          >
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            style={inputStyle}
            placeholder="Password"
          />

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 8,
                background: '#fef2f2',
                color: '#b91c1c',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              marginTop: 18,
              border: 0,
              borderRadius: 8,
              padding: '11px 14px',
              background: 'var(--color-primary)',
              color: '#fff',
              fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Memproses…' : 'Masuk'}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '22px 0',
                color: 'var(--color-text-muted)',
                fontSize: 12,
              }}
            >
              <span style={{ height: 1, flex: 1, background: 'var(--color-border)' }} />
              atau
              <span style={{ height: 1, flex: 1, background: 'var(--color-border)' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <GoogleLogin
                onSuccess={onGoogleSuccess}
                onError={() => setError('Login Google gagal.')}
              />
            </div>
          </>
        )}

        <p
          style={{
            margin: '22px 0 0',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 12,
          }}
        >
          Hubungi Super Admin jika akun belum dibuat atau akses dinonaktifkan.
        </p>
      </div>
    </div>
  );
}
