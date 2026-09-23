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
    boxShadow: 'inset 0 0 0 1px var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 14,
  };

  return (
    <div className="prakasa-login"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-background)',
        padding: 20,
      }}
    >
      <svg className="prakasa-login__decoration" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="prakasa-login__crate" fill="none" stroke="#dce4f7" strokeWidth="1.5">
          <rect x="1120" y="70" width="120" height="120" rx="6"/><path d="M1120 108h120M1180 70v120"/>
          <rect x="1230" y="150" width="90" height="90" rx="6"/><path d="M1230 178h90M1275 150v90"/>
          <rect x="1080" y="210" width="70" height="70" rx="6"/><path d="M1080 231h70M1115 210v70"/>
        </g>
        <g className="prakasa-login__crate prakasa-login__crate--offset" fill="none" stroke="#dce4f7" strokeWidth="1.5">
          <rect x="90" y="620" width="130" height="130" rx="6"/><path d="M90 662h130M155 620v130"/>
          <rect x="210" y="700" width="95" height="95" rx="6"/><path d="M210 730h95M257 700v95"/>
          <rect x="40" y="740" width="60" height="60" rx="6"/><path d="M40 758h60M70 740v60"/>
        </g>
      </svg>
      <div className="prakasa-login__card fade-in"
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
          <label htmlFor="login-email" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
            style={inputStyle}
            placeholder="nama@prakasagroup.com"
          />

          <label
            htmlFor="login-password"
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
            id="login-password"
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
            className="prakasa-login__submit"
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
