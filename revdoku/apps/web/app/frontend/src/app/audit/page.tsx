import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ApiClient } from '@/lib/api-client';
import { getApiConfig, type SecurityConfig } from '@/config/api';
import { FileText, ClipboardList, Search, User, Upload, CheckSquare, Activity, List, Mail } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface HumanAction {
  description: string;
  detail: string | null;
  model_type: string | null;
  envelope_id: string | null;
}

function formatRetention(days: number): string {
  if (days >= 2555) return '7 years';
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years} year${years > 1 ? 's' : ''}`;
  }
  return `${days} days`;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function dateGroup(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const logDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - logDay.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Earlier this week';
  if (diffDays < 30) return 'This month';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const MODEL_TYPE_ICONS: Record<string, React.ReactNode> = {
  envelope: <FileText size={16} />,
  checklist: <ClipboardList size={16} />,
  report: <Search size={16} />,
  user: <User size={16} />,
  me: <User size={16} />,
  account: <User size={16} />,
  account_member: <User size={16} />,
  auth: <User size={16} />,
  audit_log: <List size={16} />,
  file: <Upload size={16} />,
  document_file: <Upload size={16} />,
  document_file_revision: <Upload size={16} />,
  check: <CheckSquare size={16} />,
  order: <User size={16} />,
  subscription_plan: <User size={16} />,
  ai_model: <Search size={16} />,
  version: <FileText size={16} />,
};

function ModelIcon({ modelType }: { modelType: string | null }) {
  const icon = modelType ? MODEL_TYPE_ICONS[modelType] : null;
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground shrink-0">
      {icon || <Activity size={16} />}
    </span>
  );
}

function summarizeRequest(log: any): string {
  const method = log.request?.method || 'GET';
  const params = log.request?.params;
  if (!params || Object.keys(params).length === 0) return `${method} request`;
  const parts: string[] = [];
  if (params.envelope_revision_id) parts.push(`revision ${params.envelope_revision_id}`);
  else if (params.envelope_id) parts.push(`envelope ${params.envelope_id}`);
  if (params.checklist_id) parts.push(`checklist ${params.checklist_id}`);
  if (params.ai_model) parts.push(`model: ${params.ai_model}`);
  if (params.format) parts.push(`format: ${params.format}`);
  if (parts.length === 0) {
    const keys = Object.keys(params).filter(k => k !== 'controller' && k !== 'action' && k !== 'format').slice(0, 3);
    if (keys.length > 0) parts.push(keys.join(', '));
  }
  return parts.length > 0 ? `${method} with ${parts.join(', ')}` : `${method} request`;
}

function summarizeResponse(log: any): string {
  const code = log.response_code;
  const resp = log.response;
  const parts: string[] = [];
  if (code >= 200 && code < 300) {
    parts.push('Success');
  } else if (code >= 400) {
    parts.push(`Failed: ${code}`);
  } else {
    parts.push(`${code}`);
  }
  if (resp?.credits > 0) parts.push(`${resp.credits} credits charged`);
  if (resp?.error) {
    const errMsg = typeof resp.error === 'string' ? resp.error : (resp.error?.message || resp.error?.error || '');
    if (errMsg) parts.push(String(errMsg).slice(0, 80));
  }
  if (resp?.size != null) parts.push(formatBytes(resp.size));
  return parts.join(', ');
}

export default function AuditPage() {
  const [searchParams] = useSearchParams();
  const envelopeId = searchParams.get('envelope_id') || undefined;
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityConfig | null>(null);
  // Category filter. 'all' = every audit row (default). URL param wins on
  // mount (deep-links from elsewhere in the app), then localStorage holds
  // the user's last choice across reloads.
  const [category, setCategory] = useState<string>(() => {
    const fromUrl = searchParams.get('category');
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem('revdoku_audit_category') || 'all'; } catch { return 'all'; }
  });

  useEffect(() => {
    getApiConfig().then((config) => {
      if (config.security) setSecurity(config.security);
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem('revdoku_audit_category', category); } catch {}
  }, [category]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.getAuditLogs({
        page,
        per_page: 50,
        envelope_id: envelopeId,
        humanize: true,
        category: category !== 'all' ? category : undefined,
      });
      setAuditLogs(res.audit_logs || []);
      setPagination(res.pagination || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, envelopeId, category]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full px-4 sm:px-6 py-1">
      {/* Unified header — one Select for category narrowing, a muted
          retention note on the right. */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-foreground">Logs</h1>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="w-[180px] h-9 text-sm" aria-label="Filter events">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Show: All events</SelectItem>
              </SelectContent>
          </Select>
          {envelopeId && (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground bg-muted px-2.5 py-1 rounded-md">
              Filtered: <code className="text-xs">{envelopeId}</code>
              <Link to="/logs" className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 ml-1">&times; Clear</Link>
            </span>
          )}
        </div>
        {security && (
          <span className="text-xs text-muted-foreground">
            Retention: {formatRetention(security.audit_retention_days)}
          </span>
        )}
      </header>

      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

      {!loading && !error && (
        <ActivityView
          auditLogs={auditLogs}
          expandedLogId={expandedLogId}
          setExpandedLogId={setExpandedLogId}
        />
      )}

      {!loading && !error && pagination && pagination.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((pagination.page - 1) * pagination.per_page) + 1}&ndash;{Math.min(pagination.page * pagination.per_page, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.total_pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
              disabled={pagination.page >= pagination.total_pages}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Activity View ---

function ActivityView({ auditLogs, expandedLogId, setExpandedLogId }: {
  auditLogs: any[];
  expandedLogId: string | null;
  setExpandedLogId: (id: string | null) => void;
}) {
  if (auditLogs.length === 0) {
    return <p className="text-muted-foreground p-3">No activity found.</p>;
  }

  // Group by date
  const groups: { label: string; logs: any[] }[] = [];
  let currentGroup: string | null = null;
  for (const log of auditLogs) {
    const group = dateGroup(log.created_at);
    if (group !== currentGroup) {
      groups.push({ label: group, logs: [] });
      currentGroup = group;
    }
    groups[groups.length - 1].logs.push(log);
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{group.label}</h3>
          <ul className="divide-y divide-border bg-card rounded-md border border-border">
            {group.logs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const human: HumanAction | null = log.human_action || null;
              const isFailed = log.response_code >= 400;
              return (
                <li key={log.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
                  <div className="p-3">
                    <div className="flex items-center gap-3">
                      <ModelIcon modelType={human?.model_type ?? null} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm ${isFailed ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                            {human?.description || log.path}
                            {isFailed && ' (failed)'}
                          </span>
                          {human?.envelope_id && (
                            <Link
                              to={`/logs?envelope_id=${human.envelope_id}`}
                              className="text-xs text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400 truncate max-w-[160px]"
                              onClick={(e) => e.stopPropagation()}
                              title={human.envelope_id}
                            >
                              {human.envelope_id}
                            </Link>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {log.user_name || 'System'}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                        {human?.detail && (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">{human.detail}</span>
                        )}
                        {!human?.detail && log.response?.credits > 0 && (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">{log.response.credits} cr</span>
                        )}
                        <span title={new Date(log.created_at).toLocaleString()}>{relativeTime(log.created_at)}</span>
                        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border bg-muted/30 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                        <div>
                          <span className="font-medium text-foreground">Request ID</span>
                          <p className="font-mono text-muted-foreground select-all break-all">{log.request_id || 'N/A'}</p>
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Duration</span>
                          <p className="text-muted-foreground">{log.duration != null ? `${log.duration}ms` : 'N/A'}</p>
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Status</span>
                          <p className="text-muted-foreground">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${statusColor(log.response_code)}`}>{log.response_code}</span>
                            {' '}{log.request?.method || 'GET'}
                          </p>
                        </div>
                      </div>
                      {/* One-line summaries instead of raw JSON */}
                      <div className="text-xs space-y-1">
                        <div>
                          <span className="font-medium text-foreground">Request: </span>
                          <span className="text-muted-foreground">{summarizeRequest(log)}</span>
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Response: </span>
                          <span className="text-muted-foreground">{summarizeResponse(log)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- API Logs View (original implementation, unchanged) ---

function ApiLogsView({ auditLogs, expandedLogId, setExpandedLogId }: {
  auditLogs: any[];
  expandedLogId: string | null;
  setExpandedLogId: (id: string | null) => void;
}) {
  return (
    <div>
      <ul className="divide-y divide-border bg-card rounded-md border border-border">
        {auditLogs.length === 0 && (
          <li className="p-3 text-muted-foreground">No audit logs found.</li>
        )}
        {auditLogs.map((log) => {
          const isExpanded = expandedLogId === log.id;
          const method = log.request?.method || 'GET';
          return (
            <li key={log.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
              <div className="p-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 font-medium text-foreground min-w-0">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${methodColor(method)}`}>{method}</span>
                    <span className="truncate">{log.path}</span>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${statusColor(log.response_code)}`}>{log.response_code}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {log.response?.credits > 0 && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{log.response.credits} cr</span>
                    )}
                    <span className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
                    <span className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  <span>{log.user_name || 'System'}</span>
                  <span>&middot;</span>
                  <span>IP: {log.ip}</span>
                  <span>&middot;</span>
                  <span>Source: {log.source_type}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border bg-muted/30 p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <span className="font-medium text-foreground">Request ID</span>
                      <p className="font-mono text-muted-foreground select-all break-all">{log.request_id || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Duration</span>
                      <p className="text-muted-foreground">{log.duration != null ? `${log.duration}ms` : 'N/A'}</p>
                    </div>
                  </div>
                  <div className="text-xs">
                    <span className="font-medium text-foreground">User Agent</span>
                    <p className="text-muted-foreground break-all">{log.user_agent || 'N/A'}</p>
                  </div>

                  <div>
                    <h4 className="text-xs font-medium text-foreground mb-1">Request Params</h4>
                    {log.request?.params && Object.keys(log.request.params).length > 0 ? (
                      <pre className="whitespace-pre-wrap break-words text-xs text-foreground bg-background border border-border p-2 rounded overflow-auto max-h-48">{formatJsonSafe(log.request.params)}</pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">No params</p>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-medium text-foreground mb-1">
                      Response
                      {log.response?.content_type && (
                        <span className="ml-2 font-normal text-muted-foreground">{log.response.content_type}</span>
                      )}
                      {log.response?.size != null && (
                        <span className="ml-2 font-normal text-muted-foreground">({formatBytes(log.response.size)})</span>
                      )}
                    </h4>

                    {/* Credits info */}
                    {(log.response?.credits != null || log.response?.credits_left != null) && (
                      <div className="flex items-center gap-3 text-xs mb-2">
                        {log.response.credits != null && (
                          <span className="text-muted-foreground">Credits: {log.response.credits}</span>
                        )}
                        {log.response.credits_left != null && (
                          <span className="text-muted-foreground">Remaining: {log.response.credits_left}</span>
                        )}
                      </div>
                    )}

                    {/* Error details */}
                    {log.response?.error != null && (
                      <pre className="whitespace-pre-wrap break-words text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-2 rounded overflow-auto max-h-64 mb-2">{formatJsonSafe(log.response.error)}</pre>
                    )}

                    {/* Domain data or fallback */}
                    {log.response?.data != null ? (
                      <pre className="whitespace-pre-wrap break-words text-xs text-foreground bg-background border border-border p-2 rounded overflow-auto max-h-64">{formatJsonSafe(log.response.data)}</pre>
                    ) : log.response?.success != null ? (
                      <p className="text-xs text-muted-foreground">Domain data excluded from audit log</p>
                    ) : log.response?.content_description === '[BINARY]' ? (
                      <p className="text-xs text-muted-foreground">Binary response</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">No response details captured</p>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Helpers ---

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
    case 'POST': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
    case 'PUT': case 'PATCH': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
    case 'DELETE': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  }
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
  if (code >= 300 && code < 400) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
}

function formatJsonSafe(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}
