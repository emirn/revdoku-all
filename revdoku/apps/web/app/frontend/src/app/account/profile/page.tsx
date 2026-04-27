import { useEffect, useState, useMemo, useRef } from 'react';
import { ApiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Pencil } from 'lucide-react';

interface ProfileData {
  user: {
    id: string;
    email: string;
    name: string;
    first_name: string;
    last_name: string;
    created_at: string;
    last_sign_in_at: string | null;
    last_sign_in_ip?: string | null;
    sign_in_count: number;
    time_zone: string | null;
  };
  current_account: {
    id: string;
  };
}

// Common US timezones shown first, then all others
const US_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

function getTimezoneOptions(): { value: string; label: string }[] {
  let allTimezones: string[];
  try {
    allTimezones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older browsers
    allTimezones = US_TIMEZONES;
  }

  const usOptions = US_TIMEZONES
    .filter((tz) => allTimezones.includes(tz))
    .map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }));

  const otherOptions = allTimezones
    .filter((tz) => !US_TIMEZONES.includes(tz))
    .map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }));

  return [...usOptions, ...otherOptions];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
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

export default function AccountProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTz, setSavingTz] = useState(false);

  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

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
  }, []);

  const handleTimezoneChange = async (value: string) => {
    if (!profile) return;
    setSavingTz(true);
    try {
      await ApiClient.updateProfile({ time_zone: value });
      setProfile({
        ...profile,
        user: { ...profile.user, time_zone: value },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update timezone');
    } finally {
      setSavingTz(false);
    }
  };

  const handleNameSave = async (field: 'first_name' | 'last_name', newValue: string) => {
    if (!profile) return;
    try {
      const result = await ApiClient.updateProfile({ [field]: newValue });
      setProfile({
        ...profile,
        user: {
          ...profile.user,
          [field]: newValue,
          name: result.name,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update name');
      throw err;
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

  if (error && !profile) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        <p>{error}</p>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentTz = profile.user.time_zone || detectedTz;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
          <p>{error}</p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Primary fields grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
            <Field label="Email" value={profile.user.email} />
            <EditableField
              label="First name"
              value={profile.user.first_name || ''}
              onSave={(v) => handleNameSave('first_name', v)}
            />
            <EditableField
              label="Last name"
              value={profile.user.last_name || ''}
              onSave={(v) => handleNameSave('last_name', v)}
            />
            <Field label="Member since" value={formatDate(profile.user.created_at)} />
            <Field
              label="Last sign-in"
              value={
                profile.user.last_sign_in_at
                  ? formatDateTime(profile.user.last_sign_in_at)
                  : 'Never'
              }
            />
            {profile.user.last_sign_in_ip && (
              <Field label="Last Sign-in IP" value={profile.user.last_sign_in_ip} />
            )}
          </div>
          <div className="text-xs">
            <a href="/account/security" className="text-indigo-600 hover:text-indigo-800 hover:underline">
              View sign-in history →
            </a>
          </div>

          {/* Timezone selector */}
          <div className="pt-3 border-t">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                <Globe className="h-4 w-4" />
                <span>Timezone</span>
              </div>
              <Select value={currentTz} onValueChange={handleTimezoneChange} disabled={savingTz}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {timezoneOptions.map((tz, i) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {i === US_TIMEZONES.length && (
                        <span className="sr-only">---</span>
                      )}
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {savingTz && (
                <span className="text-xs text-muted-foreground">Saving...</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
