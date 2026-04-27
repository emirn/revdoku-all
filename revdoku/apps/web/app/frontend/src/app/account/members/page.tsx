import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ApiClient } from '@/lib/api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Pencil, Check, Copy } from 'lucide-react';
import { ACCOUNT_COLORS } from '@/lib/account-colors';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import InboundEmailCard from '@ee/components/InboundEmailCard';

interface Member {
  id: number;
  prefix_id: string;
  name: string;
  email: string;
  role: string;
  is_owner: boolean;
  removable: boolean;
}

interface Permissions {
  can_add_member: boolean;
  can_manage: boolean;
}

interface Limits {
  current_count: number;
  user_limit: number | null;
  can_add_member: boolean;
}

function EditableField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setEditValue(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancel = () => {
    setEditing(false);
    setEditValue(value);
  };

  const save = async () => {
    const trimmed = editValue.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            disabled={saving}
            className="text-sm border border-input bg-background text-foreground rounded px-1.5 py-0.5 w-48 outline-none focus:ring-1 focus:ring-ring"
          />
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 group cursor-pointer" onClick={startEditing}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm flex items-center gap-1">
        {value || <span className="text-muted-foreground italic">Not set</span>}
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </span>
    </div>
  );
}

export default function AccountMembersPage() {
  const features = useFeatureFlags();
  const [members, setMembers] = useState<Member[]>([]);
  const [permissions, setPermissions] = useState<Permissions>({ can_add_member: false, can_manage: false });
  const [limits, setLimits] = useState<Limits>({ current_count: 0, user_limit: null, can_add_member: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountColor, setAccountColor] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [dataRegion, setDataRegion] = useState<{ id: string; name: string; location: string } | null>(null);
  const [savingColor, setSavingColor] = useState(false);

  // Add-member dialog state (direct add-by-email, no invitation flow)
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [membersRes, profileRes] = await Promise.all([
        ApiClient.getAccountMembers(),
        ApiClient.getAccountProfile(),
      ]);
      setMembers(membersRes.members);
      setPermissions(membersRes.permissions);
      setLimits(membersRes.limits);
      setAccountName(profileRes.profile.current_account.name || '');
      setAccountColor(profileRes.profile.current_account.primary_color || null);
      setAccountId(profileRes.profile.current_account.id || '');
      setDataRegion(profileRes.profile.current_account.data_region || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddLoading(true);
    setAddError(null);

    try {
      await ApiClient.addMemberByEmail(addEmail.trim());
      setAddOpen(false);
      setAddEmail('');
      setSuccessMessage(`${addEmail.trim()} added to the account.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      await loadData();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAddLoading(false);
    }
  };

  const handleAccountNameSave = async (newValue: string) => {
    try {
      await ApiClient.updateProfile({ account_name: newValue });
      setAccountName(newValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account name');
      throw err;
    }
  };

  const handleColorChange = async (color: string | null) => {
    if (color === (accountColor || null)) return;
    setSavingColor(true);
    try {
      await ApiClient.updateProfile({ primary_color: color });
      setAccountColor(color);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update color');
    } finally {
      setSavingColor(false);
    }
  };

  const handleRemoveMember = async (id: number, name: string) => {
    if (!confirm(`Remove ${name} from this account?`)) return;
    try {
      await ApiClient.removeMember(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
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

  if (error && members.length === 0) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        <p>{error}</p>
      </div>
    );
  }

  const hasLimit = limits.user_limit !== null;
  const atLimit = hasLimit && !limits.can_add_member;

  return (
    <div className="space-y-6">
      {/* Account identity */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            <EditableField
              label="Account name"
              value={accountName}
              onSave={handleAccountNameSave}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Account color</span>
              <div className="flex items-center gap-1.5">
                {/* "None" option */}
                <button
                  type="button"
                  disabled={savingColor}
                  onClick={() => handleColorChange(null)}
                  className="relative w-6 h-6 rounded-full border-2 border-dashed border-muted-foreground/40 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
                  style={{
                    boxShadow: !accountColor ? '0 0 0 2px white, 0 0 0 4px hsl(var(--muted-foreground))' : undefined,
                  }}
                  title="None"
                >
                  {!accountColor && (
                    <Check className="h-3.5 w-3.5 text-muted-foreground absolute inset-0 m-auto" />
                  )}
                </button>
                {ACCOUNT_COLORS.map((color) => {
                  const isSelected = color === accountColor;
                  return (
                    <button
                      key={color}
                      type="button"
                      disabled={savingColor}
                      onClick={() => handleColorChange(color)}
                      className="relative w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
                      style={{
                        backgroundColor: color,
                        boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 4px ${color}` : undefined,
                      }}
                    >
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-white absolute inset-0 m-auto" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Data region</span>
              <span className="text-sm text-foreground">
                {dataRegion
                  ? `${dataRegion.name} (${dataRegion.location})`
                  : 'n/a'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Account ID</span>
              <AccountIdField id={accountId} />
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Limit warning */}
      {atLimit && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <svg className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Seat limit reached
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Your plan allows {limits.user_limit} members.{' '}
              to add more.
            </p>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      <InboundEmailCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>{members.length} member{members.length !== 1 ? 's' : ''}</CardDescription>
          </div>
          {permissions.can_add_member && (
            <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setAddError(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={atLimit}>
                  <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Add Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add a Team Member</DialogTitle>
                  <DialogDescription>
                    Enter the email of a user who already has a Revdoku account.
                    They'll see this account the next time they sign in. If they
                    don't have an account yet, ask them to sign up first.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddMember}>
                  <div className="space-y-4 py-4">
                    {addError && (
                      <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        {addError}
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="add-email">Email</Label>
                      <Input
                        id="add-email"
                        type="email"
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                        placeholder="jane@example.com"
                        required
                        autoFocus
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={addLoading}>
                      {addLoading ? 'Adding...' : 'Add Member'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">Name</th>
                  <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">Email</th>
                  <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">Role</th>
                  {permissions.can_manage && (
                    <th className="py-3 px-4 text-right text-sm font-medium text-muted-foreground">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-border last:border-0">
                    <td className="py-3 px-4 text-sm text-foreground">
                      <div className="flex items-center gap-2">
                        {member.name}
                        {member.is_owner && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Owner</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{member.email}</td>
                    <td className="py-3 px-4 text-sm">
                      <Badge variant={member.role === 'admin' ? 'default' : 'outline'}>
                        {member.role}
                      </Badge>
                    </td>
                    {permissions.can_manage && (
                      <td className="py-3 px-4 text-right">
                        {member.removable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleRemoveMember(member.id, member.name)}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

// Read-only Account ID display with a one-click copy button. Account IDs
// (acct_…) are safe to share with support and show up in audit logs, API
// tokens, and Lockbox encryption contexts — surfacing them here gives
// admins + account owners a single place to grab the value without
// digging through Rails console or the URL bar.
function AccountIdField({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked (non-HTTPS, permission denied).
      // Silently no-op — the value is still selectable as text.
    }
  };

  return (
    <div className="flex items-center gap-2">
      <code className="text-sm font-mono text-foreground select-all">
        {id || '—'}
      </code>
      {id && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring rounded px-1 py-0.5"
          title="Copy account ID"
          aria-label="Copy account ID"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}
