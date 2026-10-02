import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';

/**
 * Lightweight notification state for global unread badge.
 * No polling, no websocket, no localStorage.
 * Refreshes on:
 *   - auth ready
 *   - explicit refreshUnreadCount() call (from Notification Center mutations)
 */
const NotificationContext = createContext({
  unreadCount: 0,
  loading: false,
  refreshUnreadCount: () => {},
});

export function NotificationProvider({ children }) {
  const { user: signedIn } = useAuth();
  // While a temporary password must be replaced the API answers only /auth/me
  // and /auth/change-password (403 PASSWORD_CHANGE_REQUIRED otherwise), so the
  // badge waits until the password is changed.
  const user = signedIn && !signedIn.passwordChangeRequired ? signedIn : null;
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get('/notifications/unread-count');
      const count = Number(r.data?.data?.count || 0);
      if (mountedRef.current) setUnreadCount(count);
    } catch {
      // Silent — badge is not critical. Do not spam toasts.
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) refreshUnreadCount();
    else setUnreadCount(0);
  }, [user, refreshUnreadCount]);

  return (
    <NotificationContext.Provider value={{ unreadCount, loading, refreshUnreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationCount() {
  return useContext(NotificationContext);
}