import { useCallback, useEffect, useState } from 'react';
import { Key, Copy, Check as CheckIcon, RefreshCw } from 'lucide-react';
import { ApiClient } from '@/lib/api-client';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ExpiresIn = '30d' | '90d' | '1y' | '3y' | '5y';

interface TokenRow {
  id: string;
  name: string;
  masked_hint: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

const EXPIRATION_OPTIONS: Array<{ value: ExpiresIn; label: string }> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: '3y', label: '3 years' },
  { value: '5y', label: '5 years' },
];

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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function AccountApiPage() {
  const features = useFeatureFlags();
  return features.api_key_management ? <MultiKeyPage /> : <SingleKeyPage />;
}

// ───────────────────────────────────────────────────────────────────────
// CE experience — exactly one API key per user. No "Create another" UI,
// no expiration picker, no name field. Matches the small-self-host shape
// where one operator uses one key.
// ───────────────────────────────────────────────────────────────────────
function SingleKeyPage() {
  const [key, setKey] = useState<TokenRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await ApiClient.getPrimaryApiKey();
      setKey(response.token);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API key');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRotate = async () => {
    setRotating(true);
    setConfirmRotate(false);
    try {
      const response = await ApiClient.rotatePrimaryApiKey();
      setKey(response.token);
      setPlaintext(response.token.plaintext_token);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate API key');
    } finally {
      setRotating(false);
    }
  };

  const handleCopy = async () => {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — user can select the text manually
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> API Access
          </CardTitle>
          <CardDescription>
            Use this API key to authenticate external integrations or scripts.
            Pass it as <code>Authorization: Bearer &lt;key&gt;</code> in request headers.
          </CardDescription>
        </CardHeader>
      </Card>

      {plaintext && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-200 text-base">
              Your new API key
            </CardTitle>
            <CardDescription className="text-amber-800 dark:text-amber-300">
              Copy this key now. For security, we won't be able to show it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md bg-background border border-amber-300 dark:border-amber-800 px-3 py-2 font-mono text-sm">
                {plaintext}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
                title={copied ? 'Copied' : 'Copy key'}
                aria-label={copied ? 'Copied' : 'Copy key'}
              >
                {copied ? <CheckIcon className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPlaintext(null)}
              >
                I've saved it — dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your API Key</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-16 animate-pulse bg-muted rounded" />
          ) : error ? (
            <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : key ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-sm text-foreground">
                      {key.masked_hint}
                    </code>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>Created {formatDate(key.created_at)}</span>
                    <span>Last used {formatRelativeTime(key.last_used_at)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  {confirmRotate ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={rotating}
                        onClick={handleRotate}
                      >
                        {rotating ? 'Rotating…' : 'Confirm rotate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRotate(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rotating}
                      onClick={() => setConfirmRotate(true)}
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" /> Rotate
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Rotating revokes the existing key immediately and issues a new one. Update any integration that used the old key.
              </p>
            </>
          ) : (
            /* Empty state — user has never generated a key. Only the explicit
               "Generate" click should mint one; loading this page must NOT
               create a credential as a side effect. */
            <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
              <div>
                <p className="text-sm text-foreground font-medium">No API key yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  API keys are only needed for external integrations or scripts that call the Revdoku API.
                  Generate one when you need it — it won't exist until you do.
                </p>
              </div>
              <Button
                variant="default"
                size="sm"
                disabled={rotating}
                onClick={handleRotate}
              >
                <Key className="h-4 w-4 mr-1.5" />
                {rotating ? 'Generating…' : 'Generate API key'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Multi-key CRUD with labels, custom expiration, and per-key revocation.
// Surfaced only when `api_key_management` is true.
// ───────────────────────────────────────────────────────────────────────
function MultiKeyPage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newExpiresIn, setNewExpiresIn] = useState<ExpiresIn>('1y');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    try {
      const response = await ApiClient.getApiKeys();
      setTokens(response.tokens);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setCreateError('Name is required');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const response = await ApiClient.createApiKey(name, newExpiresIn);
      setPlaintext(response.token.plaintext_token);
      setCopied(false);
      setNewName('');
      setNewExpiresIn('1y');
      await loadTokens();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — user can still select the text manually
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setConfirmRevokeId(null);
    try {
      await ApiClient.revokeApiKey(id);
      await loadTokens();
    } catch {
      await loadTokens();
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> API Access
          </CardTitle>
          <CardDescription>
            Create long-lived API tokens for external integrations like Zapier, Make,
            or your own scripts. Tokens are prefixed with <code>revdoku_</code> and
            can be passed as <code>Authorization: Bearer &lt;token&gt;</code>.
          </CardDescription>
        </CardHeader>
      </Card>

      {plaintext && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-200 text-base">
              Your new API token
            </CardTitle>
            <CardDescription className="text-amber-800 dark:text-amber-300">
              Copy this token now. For security, we won't be able to show it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md bg-background border border-amber-300 dark:border-amber-800 px-3 py-2 font-mono text-sm">
                {plaintext}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
                title={copied ? 'Copied' : 'Copy token'}
                aria-label={copied ? 'Copied' : 'Copy token'}
              >
                {copied ? <CheckIcon className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPlaintext(null)}
              >
                I've saved it — dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a new token</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  type="text"
                  placeholder="Zapier integration"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={creating}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expires">Expires in</Label>
                <Select
                  value={newExpiresIn}
                  onValueChange={(v) => setNewExpiresIn(v as ExpiresIn)}
                  disabled={creating}
                >
                  <SelectTrigger id="token-expires">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating ? 'Creating...' : 'Create token'}
              </Button>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active tokens</CardTitle>
          <CardDescription>
            {tokens.length === 0 && !loading
              ? 'No active API tokens'
              : 'Tokens below can be used to authenticate API requests until they expire or are revoked.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse bg-muted rounded" />
              <div className="h-16 animate-pulse bg-muted rounded" />
            </div>
          ) : error ? (
            <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't created any API tokens yet.
            </p>
          ) : (
            <div className="space-y-3">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between rounded-md border p-3 gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {token.name}
                      </span>
                      <code className="font-mono text-xs text-muted-foreground">
                        {token.masked_hint}
                      </code>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>Created {formatDate(token.created_at)}</span>
                      <span>Last used {formatRelativeTime(token.last_used_at)}</span>
                      <span>Expires {formatDate(token.expires_at)}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {confirmRevokeId === token.id ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={revokingId === token.id}
                          onClick={() => handleRevoke(token.id)}
                        >
                          {revokingId === token.id ? 'Revoking...' : 'Confirm'}
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
                        onClick={() => setConfirmRevokeId(token.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
