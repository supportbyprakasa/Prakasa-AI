import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { accountLanguageToApply, setLanguage } from '../i18n/language.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('prakasa.token');
    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const response = await api.get('/auth/me');
      setUser(response.data.data);
      return response.data.data;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.removeItem('prakasa.token');
        setUser(null);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    refreshUser()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshUser]);

  useEffect(() => {
    const onFocus = () => {
      if (localStorage.getItem('prakasa.token')) {
        refreshUser().catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshUser]);

  const loginWithToken = async (token) => {
    localStorage.setItem('prakasa.token', token);
    const signedIn = await refreshUser();
    // The interface follows the language saved on the account. setLanguage()
    // reloads once; afterwards this browser and the account agree, so it
    // cannot loop.
    const language = accountLanguageToApply(signedIn?.language);
    if (language) setLanguage(language);
    return signedIn;
  };

  // "Keluar" ends this account's sessions on every device (POST /auth/logout).
  // Best effort: the browser is signed out even when the call fails.
  const logout = async () => {
    if (localStorage.getItem('prakasa.token')) {
      try {
        await api.post('/auth/logout', null, { timeout: 4000 });
      } catch {
        // Offline or the session already ended; clearing locally is enough.
      }
    }
    localStorage.removeItem('prakasa.token');
    setUser(null);
    location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
