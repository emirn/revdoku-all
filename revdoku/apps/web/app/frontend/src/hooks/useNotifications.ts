import { useCallback, useEffect, useRef, useState } from 'react';
import { getCableConsumer } from '@/lib/cable';
import { ApiClient } from '@/lib/api-client';
import { getNotificationConfig } from '@/lib/notification-types';
import { showToast } from '@/lib/toast';
import { getActiveInspection, signalInspectionComplete } from '@/lib/inspection-signal';
import type { Subscription } from '@rails/actioncable';

export interface NotificationItem {
  id: string;
  type: string;
  params: Record<string, string>;
  account_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications(currentAccountId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const isLoadedRef = useRef(false);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Keep ref in sync with state
  useEffect(() => { isLoadedRef.current = isLoaded; }, [isLoaded]);

  // Fetch unread count (re-fetch when account changes)
  useEffect(() => {
    // Reset loaded state so dropdown re-fetches for new account
    setIsLoaded(false);
    setNotifications([]);

    ApiClient.getNotificationUnreadCount()
      .then(res => setUnreadCount(res.unread_count))
      .catch(() => {});
  }, [currentAccountId]);

  // Subscribe to ActionCable
  useEffect(() => {
    const consumer = getCableConsumer();

    subscriptionRef.current = consumer.subscriptions.create('NotificationChannel', {
      received(data: { id: string; type: string; account_id: string | null; params: Record<string, string>; created_at: string }) {
        const config = getNotificationConfig(data.type, data.params);

        // Only show toast + increment for current-account or user-level notifications
        const isRelevant =
          config.scope === 'user' ||
          (config.scope === 'account' && data.account_id === currentAccountId);

        if (isRelevant) {
          setUnreadCount(prev => prev + 1);
          showToast(config.message, config.toastType);

          // Signal active inspection to shortcut polling (handles both completed and failed)
          if ((data.type === 'report_completed' || data.type === 'report_failed') &&
              data.params.envelope_id === getActiveInspection()) {
            signalInspectionComplete(data.params.envelope_id, data.params.report_id);
          }

          // Prepend to list if it's been loaded (even if currently empty)
          if (isLoadedRef.current) {
            setNotifications(prev => [{
              id: data.id,
              type: data.type,
              params: data.params,
              account_id: data.account_id,
              read_at: null,
              created_at: data.created_at,
            }, ...prev]);
          }
        }
      },
    });

    return () => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [currentAccountId]);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await ApiClient.getNotifications();
      setNotifications(res.notifications);
      setIsLoaded(true);
    } catch {
      // ignore
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await ApiClient.markNotificationAsRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await ApiClient.markAllNotificationsAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, []);

  return {
    unreadCount,
    notifications,
    isLoaded,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  };
}
