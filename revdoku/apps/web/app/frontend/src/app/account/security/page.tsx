import { useEffect, useState, useCallback } from 'react';
import { ApiClient } from '@/lib/api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { HighSecurityModeCard } from '@ee/components/HighSecurityModeCard';

interface ProfileData {
  user: {
    two_factor_enabled: boolean;
  };
  login_history: Array<{
    ip_address?: string;
    user_agent?: string | null;
    device_summary: string;
    signed_in_at: string;
  }>;
  current_account: {
    security_level: string;
    hipaa_enabled: boolean;
  };
}

interface SessionData {
  id: string;
  device_info: Record<string, string>;
  display_device: string;
  ip_address?: string | null;
  last_used_at: string | null;
  created_at: string;
  is_current: boolean;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AccountSecurityPage() {
  const features = useFeatureFlags();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const response = await ApiClient.getSessions();
      setSessions(response.sessions);
    } catch {
      // Sessions loading failure is non-critical
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await ApiClient.getAccountProfile();
        setProfile(response.profile);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
    loadSessions();
  }, [loadSessions]);

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    setConfirmRevokeId(null);
    try {
      const result = await ApiClient.revokeSession(sessionId);
      if (result.revoked_current) {
        window.location.href = '/users/sign_in';
        return;
      }
      await loadSessions();
    } catch {
      // Reload sessions to get current state
      await loadSessions();
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAllOthers = async () => {
    setConfirmRevokeAll(false);
    setRevokingId('all');
    try {
      await ApiClient.revokeAllOtherSessions();
      await loadSessions();
    } catch {
      await loadSessions();
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse bg-muted rounded" />
        <div className="h-64 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        <p>{error}</p>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const isHighSecurity = profile.current_account.security_level === 'high';
  const isHipaa = profile.current_account.hipaa_enabled;
  const otherSessionCount = sessions.filter(s => !s.is_current).length;

  return (
    <div className="space-y-6">
      {/* Two-Factor Authentication Card */}
      <Card>
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            {isHighSecurity ? 'Required for high security mode' : 'Recommended for all accounts'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profile.user.two_factor_enabled ? (
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 mt-0.5 shrink-0 text-green-600"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm text-green-700">
                  Two-factor authentication is enabled.
                </p>
                <a
                  href="/users/two_factor_authentication"
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Manage 2FA
                </a>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 mt-0.5 shrink-0 text-amber-500"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm text-amber-700">
                  {isHighSecurity
                    ? 'Two-factor authentication is required for this account. You must set up 2FA to continue using the app.'
                    : 'Two-factor authentication is not enabled. We strongly recommend enabling 2FA to protect your account.'}
                </p>
                <a
                  href="/users/two_factor_authentication"
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {isHighSecurity ? 'Set Up 2FA Now' : 'Enable 2FA'}
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Sessions Card — only shown when sessions_management feature is enabled */}
      {features.sessions_management && (
      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>
            Devices currently signed in to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse bg-muted rounded" />
              <div className="h-16 animate-pulse bg-muted rounded" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {session.display_device || 'Unknown device'}
                      </span>
                      {session.is_current && (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          This device
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {session.ip_address && (
                        <span className="font-mono">{session.ip_address}</span>
                      )}
                      <span>Active {formatRelativeTime(session.last_used_at)}</span>
                      <span>
                        Since {new Date(session.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                  {!session.is_current && (
                    <div className="ml-3 shrink-0">
                      {confirmRevokeId === session.id ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={revokingId === session.id}
                            onClick={() => handleRevoke(session.id)}
                          >
                            {revokingId === session.id ? 'Revoking...' : 'Confirm'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmRevokeId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revokingId !== null}
                          onClick={() => setConfirmRevokeId(session.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {otherSessionCount >= 2 && (
                <div className="pt-2 border-t">
                  {confirmRevokeAll ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revokingId === 'all'}
                        onClick={handleRevokeAllOthers}
                      >
                        {revokingId === 'all' ? 'Revoking...' : 'Confirm sign out all others'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRevokeAll(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokingId !== null}
                      onClick={() => setConfirmRevokeAll(true)}
                    >
                      Sign out all other devices
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <HighSecurityModeCard isHighSecurity={isHighSecurity} isHipaa={isHipaa} />

      {/* Login History Card */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Login History</CardTitle>
          <CardDescription>Your last 5 login sessions</CardDescription>
        </CardHeader>
        <CardContent>
          {profile.login_history.length === 0 ? (
            <p className="text-muted-foreground">No login history available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Date & Time
                    </th>
                    {isHighSecurity && (
                      <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                        IP Address
                      </th>
                    )}
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Device
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profile.login_history.map((login, index) => (
                    <tr key={index} className="border-b border-border last:border-0">
                      <td className="py-3 px-4 text-sm text-foreground">
                        {new Date(login.signed_in_at).toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      {isHighSecurity && (
                        <td className="py-3 px-4 text-sm font-mono text-foreground">
                          {login.ip_address || 'Unknown'}
                        </td>
                      )}
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {isHighSecurity ? (login.user_agent || login.device_summary) : login.device_summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
