import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('prakasa.token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then((r) => setUser(r.data.data))
      .catch(() => localStorage.removeItem('prakasa.token'))
      .finally(() => setLoading(false));
  }, []);

  const loginWithToken = async (token) => {
    localStorage.setItem('prakasa.token', token);
    const r = await api.get('/auth/me');
    setUser(r.data.data);
  };

  const logout = () => {
    localStorage.removeItem('prakasa.token');
    setUser(null);
    location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
