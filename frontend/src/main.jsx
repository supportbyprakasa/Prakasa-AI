// Design tokens and shared component styles load first so page styles can refine them.
import './styles/tokens.css';
import './styles/state.css';
import './components/button.css';
import './components/field.css';
import './components/card.css';
import './components/dialog.css';
import './components/tooltip.css';
import './styles/doodles.css';
import './styles/patterns.css';
import { installPwRipple } from './styles/ripple';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import ToastHost from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { bootLanguage } from './i18n/boot';

installPwRipple();

const app = (
  <BrowserRouter
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  >
    <AuthProvider>
      <NotificationProvider>
        <ErrorBoundary>
          <App />
          <ToastHost />
        </ErrorBoundary>
      </NotificationProvider>
    </AuthProvider>
  </BrowserRouter>
);

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const googleEnabled =
  import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true' && Boolean(googleClientId);

// The language is settled before the first render: Indonesian resolves at
// once; English first loads its dictionary and starts the DOM translator, so
// the first paint is already translated.
bootLanguage().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {googleEnabled ? (
        <GoogleOAuthProvider clientId={googleClientId}>{app}</GoogleOAuthProvider>
      ) : (
        app
      )}
    </React.StrictMode>
  );
});
