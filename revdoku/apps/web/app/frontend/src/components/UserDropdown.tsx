import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '@/lib/api-client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Users, Check, Settings, Moon, Sun, Monitor, Keyboard, LifeBuoy } from 'lucide-react';
import { useTheme, type Theme } from '@/context/ThemeContext';
import { getAccountColor } from '@/lib/account-colors';
import { SUPPORT_MAILTO } from '@/lib/support';
import { AccountBilling } from '@ee/components/AccountBilling';

interface AccountInfo {
  id: string;
  name: string;
  personal: boolean;
  primary_color?: string | null;
  role: string;
  members_count: number;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
  current_account?: {
    id: string;
    name: string;
    personal: boolean;
    primary_color?: string | null;
  } | null;
  accounts?: AccountInfo[];
}

interface UserDropdownProps {
  user?: UserInfo | null;
  onShowShortcuts?: () => void;
}

export function UserDropdown({ user: userProp, onShowShortcuts }: UserDropdownProps) {
  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [user, setUser] = useState<UserInfo | null>(userProp ?? null);
  const [loading, setLoading] = useState(!userProp);
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);

  // Sync from prop when it arrives
  useEffect(() => {
    if (userProp) {
      setUser(userProp);
      setLoading(false);
    }
  }, [userProp]);

  useEffect(() => {
    async function loadData() {
      try {
        if (!userProp) {
          const res = await ApiClient.getCurrentUser();
          setUser(res.user);
        }
      } catch (error) {
        console.error('Failed to load user data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [userProp]);

  const handleLogout = async () => {
    try {
      const response = await ApiClient.logout();
      window.location.href = response.redirect_to || '/users/sign_in';
    } catch (error) {
      console.error('Logout failed:', error);
      window.location.href = '/users/sign_in';
    }
  };

  const handleSwitchAccount = async (accountId: string) => {
    try {
      await ApiClient.switchAccount(accountId);
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch account:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-24 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const hasMultipleAccounts = user.accounts && user.accounts.length > 1;
  const accountColor = user.current_account ? getAccountColor(user.current_account.id, user.current_account.primary_color) : undefined;

  const handleDropdownOpenChange = (isOpen: boolean) => {
    if (isOpen) setBillingRefreshKey(k => k + 1);
  };

  return (
    <DropdownMenu onOpenChange={handleDropdownOpenChange}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-3 py-2 text-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
          {/* Desktop: two-line layout */}
          <div className="hidden sm:flex flex-col items-start">
            <span className="text-xs font-medium">{user.name || user.email}</span>
            {hasMultipleAccounts && user.current_account && (
              <span className="text-[11px] text-muted-foreground" style={accountColor ? { color: accountColor } : undefined}>
                {user.current_account.name}
              </span>
            )}
          </div>
          {/* Mobile: user icon */}
          <span className="sm:hidden flex items-center">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </span>
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-semibold">{user.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
            {user.current_account && (
              <span className="mt-1 text-xs font-medium text-primary" style={accountColor ? { color: accountColor } : undefined}>
                {user.current_account.name}
              </span>
            )}
            <AccountBilling refreshKey={billingRefreshKey} />
          </div>
        </DropdownMenuLabel>

        {hasMultipleAccounts && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Users className="mr-2 h-4 w-4" />
                Switch Account
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {user.accounts!.map(account => {
                  const isCurrent = account.id === user.current_account?.id;
                  const color = account.primary_color || null;
                  return (
                    <DropdownMenuItem
                      key={account.id}
                      disabled={isCurrent}
                      className={isCurrent ? 'bg-accent/50' : ''}
                      onClick={() => !isCurrent && handleSwitchAccount(account.id)}
                    >
                      <div className="flex flex-col flex-1">
                        <span className="text-sm" style={color ? { color } : undefined}>{account.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {account.role === 'owner' ? 'Owner' : account.role === 'admin' ? 'Admin' : 'Member'}
                          {!account.personal && ` · ${account.members_count} members`}
                        </span>
                      </div>
                      {isCurrent && <Check className="h-4 w-4 shrink-0 ml-2" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/account/profile')}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        {onShowShortcuts && (
          <DropdownMenuItem onClick={onShowShortcuts}>
            <Keyboard className="mr-2 h-4 w-4" />
            Keyboard Shortcuts
            <span className="ml-auto text-[10px] text-muted-foreground tracking-widest">
              {/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘/' : 'Ctrl+/'}
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => window.open('https://revdoku.com/community', '_blank', 'noopener,noreferrer')}>
          <LifeBuoy className="mr-2 h-4 w-4" />
          Get Help
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.location.href = SUPPORT_MAILTO}>
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          Contact Us
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => {
          const themes: Theme[] = ['system', 'light', 'dark'];
          const idx = themes.indexOf(theme);
          setTheme(themes[(idx + 1) % themes.length]);
        }}>
          {theme === 'system' ? <Monitor className="mr-2 h-4 w-4" />
           : resolvedTheme === 'dark' ? <Moon className="mr-2 h-4 w-4" />
           : <Sun className="mr-2 h-4 w-4" />}
          Theme: {theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} destructive>
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
