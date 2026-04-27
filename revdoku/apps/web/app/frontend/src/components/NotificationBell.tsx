import React, { useRef, useState, useEffect } from 'react';
import { Bell, Eye } from 'lucide-react';
import { useNotifications, type NotificationItem } from '@/hooks/useNotifications';
import { getNotificationConfig } from '@/lib/notification-types';
import { useNavigate } from 'react-router-dom';
import { useEnvelopeTitles } from '@/context/EnvelopeTitleContext';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function linkifyText(text: string): React.ReactNode {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const parts = text.split(emailRegex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    emailRegex.test(part) ? (
      <a key={i} href={`mailto:${part}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {part}
      </a>
    ) : part
  );
}

export function NotificationBell({ currentAccountId }: { currentAccountId?: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const {
    unreadCount,
    notifications,
    isLoaded,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications(currentAccountId);

  const envelopeTitleMap = useEnvelopeTitles();

  // Load notifications when dropdown opens
  useEffect(() => {
    if (open && !isLoaded) {
      fetchNotifications();
    }
  }, [open, isLoaded, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleNavigate = (notification: NotificationItem) => {
    const config = getNotificationConfig(notification.type, notification.params);
    if (!notification.read_at) {
      markAsRead(notification.id);
    }
    const url = config.getUrl(notification.params);
    if (url) {
      navigate(url);
    }
    setOpen(false);
  };

  const handleMarkAsRead = (e: React.MouseEvent, notification: NotificationItem) => {
    e.stopPropagation();
    markAsRead(notification.id);
  };

  return (
    <div className="relative mr-2" ref={panelRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="relative p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-border bg-background shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-medium">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!isLoaded ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</div>
            ) : (
              notifications.map(notification => {
                const config = getNotificationConfig(notification.type, notification.params);
                const Icon = config.icon;
                const hasUrl = !!config.getUrl(notification.params);
                return (
                  <div
                    key={notification.id}
                    className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 ${
                      !notification.read_at ? 'bg-primary/5' : ''
                    }`}
                  >
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.iconColor}`} />
                    <div className="flex-1 min-w-0">
                      {hasUrl ? (
                        <button
                          onClick={() => handleNavigate(notification)}
                          className="text-sm text-left hover:underline"
                        >
                          {config.message}
                        </button>
                      ) : (
                        <p className="text-sm">{config.message}</p>
                      )}
                      {config.getDetail?.(notification.params) && (() => {
                        const detail = config.getDetail!(notification.params);
                        const envelopeId = notification.params.envelope_id;
                        const envelopeTitle = envelopeId ? envelopeTitleMap.get(envelopeId) : undefined;
                        return (
                          <p className="text-xs text-muted-foreground mt-0.5" title={envelopeTitle ? `ID: ${envelopeId}` : undefined}>
                            {envelopeTitle ? linkifyText(envelopeTitle) : linkifyText(detail!)}
                          </p>
                        );
                      })()}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {timeAgo(notification.created_at)}
                      </p>
                    </div>
                    {!notification.read_at && (
                      <button
                        onClick={(e) => handleMarkAsRead(e, notification)}
                        className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="Mark as read"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
