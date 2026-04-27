import { CheckCircle, XCircle, Bell, Mail, MailX, type LucideIcon } from 'lucide-react';
import type { AppToastPayload } from '@/lib/toast';

export interface NotificationTypeConfig {
  scope: 'account' | 'user';
  icon: LucideIcon;
  iconColor: string;
  toastType: AppToastPayload['type'];
  message: string;
  getDetail?: (params: Record<string, string>) => string | null;
  getUrl: (params: Record<string, string>) => string | null;
}

// Format helpers for notification detail lines. Kept inline rather than
// pulled into a shared formatter because the rules are tiny and specific
// to this surface.
const formatCredits = (raw: string | undefined) => {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString()} credits`;
};

const formatAmount = (raw: string | undefined) => {
  const cents = Number(raw ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
};

const joinParts = (...parts: Array<string | null | undefined>) =>
  parts.filter(Boolean).join(' · ') || null;


export const NOTIFICATION_CONFIG: Record<string, NotificationTypeConfig> = {
  report_completed: {
    scope: 'account',
    icon: CheckCircle,
    iconColor: 'text-green-600',
    toastType: 'success',
    message: 'Review completed',
    getDetail: (p) => p.envelope_id ? `Envelope ${p.envelope_id}` : null,
    getUrl: (p) => `/envelopes/view?id=${p.envelope_id}`,
  },
  report_failed: {
    scope: 'account',
    icon: XCircle,
    iconColor: 'text-red-500',
    toastType: 'error',
    message: 'Review failed',
    getDetail: (p) => p.error_message || (p.envelope_id ? `Envelope ${p.envelope_id}` : null),
    getUrl: (p) => `/envelopes/view?id=${p.envelope_id}`,
  },
};

const FALLBACK: NotificationTypeConfig = {
  scope: 'user',
  icon: Bell,
  iconColor: 'text-muted-foreground',
  toastType: 'info',
  message: 'New notification',
  getUrl: () => null,
};

export function getNotificationConfig(
  type: string,
  params?: Record<string, string>,
): NotificationTypeConfig {
  return NOTIFICATION_CONFIG[type] ?? FALLBACK;
}
