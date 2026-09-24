import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import api from '../api/client';
import Button from '../components/Button';
import BrandDoodles from '../components/BrandDoodles';
import { useAuth } from '../context/AuthContext';
import { safeReturnPath } from './login/loginModel';

const googleEnabled =
  import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true' &&
  Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export function LoginShell({ children, aside }) {
  return (
    <main className="pw-login">
      <BrandDoodles />
      <section className="pw-login__surface">
        <div className="pw-login__intro">
          <img className="pw-login__mark" src="/logo-login.png" alt="" aria-hidden="true" />
          <h1 className="pw-login__product">Prakasa Workspace</h1>
          <p className="pw-login__tagline">
            {aside || 'Ruang kerja internal Prakasa Group untuk dokumen, approval, operasional, dan Prakasa AI.'}
          </p>
        </div>
        <div className="pw-login__panel">{children}</div>
      </section>
    </main>
  );
}

export default function Login() {
  const { user, loading, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('returnTo'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const errorRef = useRef(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (!loading && user) return <Navigate to={returnTo} replace />;

  const authenticate = async (request, fallbackMessage) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const response = await request();
      await loginWithToken(response.data.data.token);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || fallbackMessage);
      setPassword('');
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  };

  const onManualSubmit = (event) => {
    event.preventDefault();
    authenticate(
      () => api.post('/auth/login', { email, password }),
      'Login gagal. Periksa email dan password.',
    );
  };

  const onGoogleSuccess = (credentialResponse) => {
    authenticate(
      () => api.post('/auth/google', { idToken: credentialResponse.credential }),
      'Login Google gagal.',
    );
  };

  return (
    <LoginShell>
      <h2 className="pw-login__title">Masuk</h2>
      <p className="pw-login__subtitle">Gunakan akun yang diberikan administrator.</p>

      {error && (
        <div ref={errorRef} className="pw-login__error" role="alert" tabIndex={-1}>
          <AlertCircle size={20} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {googleEnabled && (
        <>
          <div className="pw-login__google" aria-busy={submitting || undefined}>
            <span className="pw-login__google-label">Masuk dengan Google Workspace</span>
            <GoogleLogin
              onSuccess={onGoogleSuccess}
              onError={() => setError('Login Google gagal.')}
              text="signin_with"
              shape="pill"
              width="320"
            />
          </div>
          <div className="pw-login__separator" role="separator"><span>atau masuk dengan email</span></div>
        </>
      )}

      <form className="pw-login__form" onSubmit={onManualSubmit}>
        <div className="g-field">
          <input
            id="login-email"
            className="g-field__input"
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            inputMode="email"
            required
            disabled={submitting}
            aria-invalid={error ? 'true' : undefined}
            placeholder=" "
          />
          <label htmlFor="login-email" className="g-field__label">Email</label>
        </div>
        <div className="g-field">
          <input
            id="login-password"
            className="g-field__input g-field__input--icon"
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
            aria-invalid={error ? 'true' : undefined}
            placeholder=" "
          />
          <label htmlFor="login-password" className="g-field__label">Password</label>
          <button
            type="button"
            className="g-field__toggle pw-icon-button pw-state-layer pw-ripple"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
            disabled={submitting}
          >
            {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        </div>
        <Button
          type="submit"
          variant={googleEnabled ? 'tonal' : 'primary'}
          block
          loading={submitting}
          className="pw-login__submit"
        >
          Masuk
        </Button>
      </form>

      <p className="pw-login__help">
        Hubungi Super Admin jika akun belum dibuat atau akses dinonaktifkan.
      </p>
    </LoginShell>
  );
}
