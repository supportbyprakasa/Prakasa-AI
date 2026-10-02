import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import api from '../api/client';
import Banner from '../components/Banner';
import BrandDoodles from '../components/BrandDoodles';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import Input from '../components/Input';
import LanguageSwitch from '../components/LanguageSwitch';
import { useAuth } from '../context/AuthContext';
import googleMark from './login/google-g.svg';
import { safeReturnPath } from './login/loginModel';
import './login/login.css';

const googleEnabled =
  import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true' &&
  Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

// The Google "G" keeps Google's own brand colours, so it is an image asset
// (login/google-g.svg), not a themed icon.
function GoogleMark() {
  return <img className="pw-login__google-mark" src={googleMark} width="18" height="18" alt="" aria-hidden="true" />;
}

// Its own component so useGoogleLogin (which needs GoogleOAuthProvider's
// context) is only ever called while that provider is actually mounted —
// main.jsx only wraps the app with it when googleEnabled is true.
function GoogleSignInButton({ onSuccess, onError, disabled }) {
  const login = useGoogleLogin({
    flow: 'auth-code',
    scope: 'openid email profile',
    onSuccess,
    onError,
  });

  return (
    <Button
      type="button"
      variant="secondary"
      block
      onClick={() => login()}
      disabled={disabled}
      className="pw-login__google-btn"
    >
      <GoogleMark />
      <span className="pw-button__label">Masuk dengan Google</span>
    </Button>
  );
}

export function LoginShell({ children, aside }) {
  return (
    <main className="pw-login">
      <BrandDoodles />
      <div className="pw-login__language"><LanguageSwitch /></div>
      <section className="pw-login__surface">
        <div className="pw-login__intro">
          <img className="pw-login__mark" src="/logo-login.png" alt="" aria-hidden="true" />
          <h1 className="pw-login__product">Prakasa Workspace</h1>
          <p className="pw-login__tagline">
            {aside || 'Ruang kerja internal Prakasa Foods Nusantara untuk dokumen, approval, operasional, dan Prakasa AI.'}
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
  const [fieldErrors, setFieldErrors] = useState({});
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
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Isi email.';
    if (!password) nextErrors.password = 'Isi kata sandi.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    authenticate(
      () => api.post('/auth/login', { email, password }),
      'Gagal masuk. Periksa email dan kata sandi.',
    );
  };

  const onGoogleSuccess = (codeResponse) => {
    authenticate(
      () => api.post('/auth/google', { code: codeResponse.code }),
      'Gagal masuk dengan Google.',
    );
  };

  return (
    <LoginShell>
      <h2 className="pw-login__title">Masuk</h2>
      <p className="pw-login__subtitle">Gunakan akun yang diberikan administrator.</p>

      {error && (
        <div ref={errorRef} className="pw-login__error" tabIndex={-1}>
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <form className="pw-login__form" onSubmit={onManualSubmit} noValidate>
        <Input
          id="login-email"
          label="Email"
          type="email"
          name="email"
          value={email}
          error={fieldErrors.email}
          onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
          autoComplete="username"
          inputMode="email"
          required
          disabled={submitting}
        />
        <div className="pw-login__password">
          <Input
            id="login-password"
            label="Kata sandi"
            className="pw-login__password-input"
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={password}
            error={fieldErrors.password}
            onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); }}
            autoComplete="current-password"
            required
            disabled={submitting}
          />
          <span className="pw-login__password-toggle">
            <IconButton
              size="sm"
              icon={showPassword ? 'visibility_off' : 'visibility'}
              label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              onClick={() => setShowPassword((current) => !current)}
              disabled={submitting}
            />
          </span>
        </div>
        <Button
          type="submit"
          variant="primary"
          block
          loading={submitting}
          className="pw-login__submit"
        >
          Masuk
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="pw-login__separator" role="separator"><span>atau masuk dengan Google</span></div>
          <GoogleSignInButton
            onSuccess={onGoogleSuccess}
            onError={() => setError('Gagal masuk dengan Google.')}
            disabled={submitting}
          />
        </>
      )}

      <p className="pw-login__help">
        Hubungi Super Admin jika akun belum dibuat atau akses dinonaktifkan.
      </p>
    </LoginShell>
  );
}
