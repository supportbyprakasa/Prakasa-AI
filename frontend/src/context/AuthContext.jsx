import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';

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
    return refreshUser();
  };

  const logout = () => {
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
