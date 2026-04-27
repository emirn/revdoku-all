import './globals.css';
import NavLink from '@/components/NavLink';
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { AppToastPayload } from '@/lib/toast';
import { ThemeProvider } from '@/context/ThemeContext';
import { AppFooter } from '@/components/AppFooter';
import { UserDropdown } from '@/components/UserDropdown';
import KeyboardShortcutsDialog from '@/components/KeyboardShortcutsDialog';
import { ApiClient } from '@/lib/api-client';
import { getApiConfig } from '@/config/api';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { FileText, ClipboardCheck, ScrollText, Menu, Paperclip } from 'lucide-react';
import { useGlobalSaveIndicator } from '@/hooks/useGlobalSaveIndicator';
import { NotificationBell } from '@/components/NotificationBell';
import { SUPPORT_EMAIL } from '@/lib/support';

function GlobalSaveIndicator() {
  const status = useGlobalSaveIndicator();
  if (status === 'idle') return null;
  return (
    <span className={`text-xs mr-3 ${
      status === 'saving' ? 'text-blue-600' :
      status === 'saved' ? 'text-green-600' :
      'text-red-600'
    }`}>
      {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : 'Save failed'}
    </span>
  );
}

function MainContent({ children, isViewPage }: { children: React.ReactNode; isViewPage: boolean }) {
  if (isViewPage) {
    return (
      <div className="px-2 sm:px-4 flex-1 flex flex-col min-h-0 w-full">
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl py-0.5 sm:py-1 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0 w-full">
      {children}
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isMainAppPage = location.pathname.startsWith('/envelopes') || location.pathname.startsWith('/checklists') || location.pathname.startsWith('/logs') || location.pathname.startsWith('/library');
  const isEnvelopeViewPage = location.pathname.startsWith('/envelopes/view');
  const [toasts, setToasts] = useState<Array<{ id: number; payload: AppToastPayload }>>([]);
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);

  // Global Cmd+/ (Ctrl+/) — toggle keyboard shortcuts dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowShortcutsDialog(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  const [appVersion, setAppVersion] = useState<string>('');
  const [appRevision, setAppRevision] = useState<string>('');
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState<number | undefined>();
  const [userData, setUserData] = useState<{
    id: string;
    email: string;
    name: string;
    current_account?: { id: string; name: string; personal: boolean; primary_color?: string | null } | null;
    accounts?: Array<{
      id: string;
      name: string;
      personal: boolean;
      primary_color?: string | null;
      role: string;
      members_count: number;
    }>;
  } | null>(null);

  // Account color accent. When the current account has a primary_color set
  // we surface it on the header in two subtle ways: a 3px color strip along
  // the top of the nav, and a faint horizontal gradient fade toward the
  // right edge behind the notification bell + user dropdown. Both are
  // non-interactive decoration — they just confirm at-a-glance which
  // account context the user is looking at, without forcing them to click
  // to expand the account picker.
  const accountColor = userData?.current_account?.primary_color || null;

  useIdleTimeout(idleTimeoutSeconds);

  useEffect(() => {
    getApiConfig().then(config => {
      setAppVersion(config.appVersion || '');
      setAppRevision(config.appRevision || '');
      setIdleTimeoutSeconds(config.security?.idle_timeout_seconds);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    ApiClient.getCurrentUser()
      .then(res => setUserData(res.user))
      .catch((err) => console.error('Failed to fetch user data:', err));
  }, []);

  useEffect(() => {
    let counter = 1;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AppToastPayload>).detail;
      if (!detail) return;
      const id = counter++;
      setToasts((prev) => [...prev, { id, payload: detail }]);
      if (detail.type !== 'error') {
        const timeout = detail.durationMs ?? 2500;
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, timeout);
      }
    };
    document.addEventListener('app:toast', handler as EventListener);
    return () => document.removeEventListener('app:toast', handler as EventListener);
  }, []);

  return (
    <ThemeProvider>
      <div className={`${isMainAppPage ? 'h-screen' : 'min-h-screen'} flex flex-col bg-background`}>
        <nav className="relative bg-background shadow-sm border-b border-border">
          {accountColor && (
            <>
              {/* Top color strip — 3px band across the nav's top edge. */}
              <div
                aria-hidden="true"
                className="absolute top-0 left-0 right-0 h-[3px] pointer-events-none"
                style={{ backgroundColor: accountColor }}
              />
              {/* Right-edge gradient fade — fades from transparent to a
                  muted tint of the account color, ending where the user
                  dropdown sits. Low alpha so it reads as context, not a
                  branding takeover. */}
              <div
                aria-hidden="true"
                className="absolute inset-y-0 right-0 w-1/3 pointer-events-none opacity-70"
                style={{
                  background: `linear-gradient(to right, transparent, ${accountColor}22 60%, ${accountColor}33)`
                }}
              />
            </>
          )}
          <div className={`relative px-4 sm:px-6 lg:px-8 ${!isMainAppPage ? 'mx-auto max-w-7xl' : ''}`}>
            <div className="flex h-16 justify-between">
              <div className="flex">
                {isMainAppPage && (
                  <button
                    onClick={() => document.dispatchEvent(new Event('sidebar:toggle'))}
                    className="flex-shrink-0 p-2 -ml-2 mr-1 rounded-md hover:bg-muted transition-colors"
                    aria-label="Toggle sidebar"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                )}
                <div className={`flex flex-shrink-0 items-center ${isMainAppPage ? 'lg:w-48' : ''}`}>
                  <span className="relative text-xl font-bold text-primary tracking-wide">REVDOKU<span className="absolute -top-1.5 -right-6 text-[8px] font-semibold text-muted-foreground">beta</span></span>
                </div>
                <div className="ml-6 flex space-x-4 sm:space-x-8">
                  <NavLink to="/envelopes"><FileText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Envelopes</span></NavLink>
                  <NavLink to="/checklists"><ClipboardCheck className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Checklists</span></NavLink>
                  <NavLink to="/library"><Paperclip className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Library</span></NavLink>
                  <NavLink to="/logs"><ScrollText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Logs</span></NavLink>
                </div>
              </div>
              <div className="flex items-center">
                <GlobalSaveIndicator />
                <NotificationBell currentAccountId={userData?.current_account?.id} />
                <UserDropdown user={userData} onShowShortcuts={() => setShowShortcutsDialog(true)} />
              </div>
            </div>
          </div>
        </nav>
        <main className="flex-1 flex flex-col min-h-0">
          <MainContent isViewPage={isMainAppPage}>{children}</MainContent>
        </main>

        {!isEnvelopeViewPage && <AppFooter appVersion={appVersion} appRevision={appRevision} />}

        <KeyboardShortcutsDialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog} />

        {/* App Toasts */}
        <div className="fixed top-20 right-4 z-50 space-y-2">
          {toasts.map(({ id, payload }) => (
            <div
              key={id}
              className={`px-3 py-2 rounded-md shadow-md text-sm border max-w-[30vw] ${
                payload.type === 'error'
                  ? 'bg-destructive text-destructive-foreground border-destructive'
                  : payload.type === 'info'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-green-600 text-white border-green-700'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="flex-1">
                  {payload.message}
                  {payload.type === 'error' && SUPPORT_EMAIL && (
                    <>
                      {' — '}
                      <a
                        href={`mailto:${SUPPORT_EMAIL}?subject=Error`}
                        className="underline hover:opacity-80"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Contact support
                      </a>
                    </>
                  )}
                </span>
                {payload.action && (
                  <button
                    onClick={() => {
                      payload.action!.onClick();
                      setToasts((prev) => prev.filter((t) => t.id !== id));
                    }}
                    className="shrink-0 underline font-medium hover:opacity-80"
                  >
                    {payload.action.label}
                  </button>
                )}
                <button
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== id))}
                  className="shrink-0 opacity-70 hover:opacity-100 font-bold leading-none"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ThemeProvider>
  );
}
