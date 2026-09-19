import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import ToastHost from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import './styles/tokens.css';

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {googleEnabled ? (
      <GoogleOAuthProvider clientId={googleClientId}>{app}</GoogleOAuthProvider>
    ) : (
      app
    )}
  </React.StrictMode>
);
