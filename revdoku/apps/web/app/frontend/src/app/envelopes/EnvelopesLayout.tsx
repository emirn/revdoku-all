import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import type { IEnvelope, ITag, TagColor } from '@revdoku/lib';
import type { ComplianceFilter } from '@/lib/envelope-grouping';
import type { ArchiveTab } from '@/hooks/useFolderView';
import { useFolderView } from '@/hooks/useFolderView';
import { getEnvelopeComplianceStatus } from '@/lib/envelope-grouping';
import { ApiClient } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { useEnvelopeTitleUpdater } from '@/context/EnvelopeTitleContext';
import EnvelopeListSidebar from '@/components/folders/EnvelopeListSidebar';
import TagManagementDialog from '@/components/folders/TagManagementDialog';
import NewLabelDialog from '@/components/folders/NewLabelDialog';
import type { FolderTransition } from '@/components/folders/GhostTransitionRow';


// Active inspection entry for dev toolbar
interface ActiveInspection {
  envelopeId: string;
  title: string;
  status: 'inspecting' | 'pending' | 'processing';
}

// Context to pass layout state to child routes
interface EnvelopesLayoutContext {
  envelopes: IEnvelope[];
  archivedEnvelopes: IEnvelope[];
  tags: ITag[];
  isLoading: boolean;
  folderView: ReturnType<typeof useFolderView>;
  refreshEnvelopes: () => Promise<void>;
  refreshTags: () => Promise<void>;
  createEnvelope: () => Promise<void>;
  createEnvelopeWithFiles: (files: File[]) => Promise<void>;
  onToggleTag: (envelopeId: string, tagId: string) => void;
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;
  registerInspection: (envelopeId: string, title: string) => void;
  unregisterInspection: (envelopeId: string) => void;
  folderTransitions: FolderTransition[];
  pulseFolders: { drafts: boolean; reviewing: boolean };
}

const LayoutContext = createContext<EnvelopesLayoutContext | null>(null);

export function useEnvelopesLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useEnvelopesLayout must be used within EnvelopesLayout');
  return ctx;
}

export default function EnvelopesLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const updateEnvelopeTitles = useEnvelopeTitleUpdater();
  const [envelopes, setEnvelopes] = useState<IEnvelope[]>([]);
  const [archivedEnvelopes, setArchivedEnvelopes] = useState<IEnvelope[]>([]);
  const [tags, setTags] = useState<ITag[]>([]);
  const [clientInspections, setClientInspections] = useState<Map<string, ActiveInspection>>(new Map());

  const registerInspection = useCallback((envelopeId: string, title: string) => {
    setClientInspections(prev => new Map(prev).set(envelopeId, { envelopeId, title, status: 'inspecting' }));
  }, []);

  const unregisterInspection = useCallback((envelopeId: string) => {
    setClientInspections(prev => { const next = new Map(prev); next.delete(envelopeId); return next; });
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [tagManagementOpen, setTagManagementOpen] = useState(false);
  const [newLabelDialogOpen, setNewLabelDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('revdoku_list_sidebar_collapsed') === 'true'; } catch { return false; }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('revdoku_list_sidebar_collapsed', String(next)); } catch { }
      return next;
    });
  }, []);

  // Listen for sidebar toggle from global hamburger button in header (desktop only).
  // On mobile (<lg), the sidebar component handles the event itself to open the drawer overlay.
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth >= 1024) toggleSidebar(); // lg breakpoint
    };
    document.addEventListener('sidebar:toggle', handler);
    return () => document.removeEventListener('sidebar:toggle', handler);
  }, [toggleSidebar]);

  // Cmd+B / Ctrl+B — toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === 'b' && (e.metaKey || e.ctrlKey) && !isInput) {
        e.preventDefault();
        document.dispatchEvent(new Event('sidebar:toggle'));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const folderView = useFolderView(envelopes, tags);

  // Compute unseen and processing folders from envelope data
  const { unseenFolders, processingFolders } = useMemo(() => {
    const unseen = { drafts: false, reviewing: false };
    const processing = { drafts: false, reviewing: false };
    for (const env of envelopes) {
      const key = getEnvelopeComplianceStatus(env);
      if ((env as any).unseen) unseen[key] = true;
      const jobStatus = (env as any).last_report?.job_status;
      if (jobStatus === 'pending' || jobStatus === 'processing') processing[key] = true;
    }
    return { unseenFolders: unseen, processingFolders: processing };
  }, [envelopes]);

  // --- Folder transition tracking ---
  const [folderTransitions, setFolderTransitions] = useState<FolderTransition[]>([]);
  const prevComplianceRef = useRef<Map<string, string>>(new Map());
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    if (envelopes.length === 0) return;

    const currentMap = new Map<string, { status: string; title: string }>();
    for (const env of envelopes) {
      currentMap.set(env.id, {
        status: getEnvelopeComplianceStatus(env),
        title: env.title || 'Untitled',
      });
    }

    if (isFirstRenderRef.current) {
      // Seed the map on first load — no transitions
      isFirstRenderRef.current = false;
      prevComplianceRef.current = new Map(
        Array.from(currentMap.entries()).map(([id, v]) => [id, v.status])
      );
      return;
    }

    const newTransitions: FolderTransition[] = [];
    for (const [id, { status, title }] of currentMap) {
      const prev = prevComplianceRef.current.get(id);
      if (prev && prev !== status) {
        newTransitions.push({
          envelopeId: id,
          title,
          fromStatus: prev as FolderTransition['fromStatus'],
          toStatus: status as FolderTransition['toStatus'],
          timestamp: Date.now(),
        });
      }
    }

    // Update the ref for next diff
    prevComplianceRef.current = new Map(
      Array.from(currentMap.entries()).map(([id, v]) => [id, v.status])
    );

    if (newTransitions.length > 0) {
      setFolderTransitions(prev => [...prev, ...newTransitions]);

      // Fire toasts
      const grouped = new Map<string, FolderTransition[]>();
      for (const t of newTransitions) {
        const key = t.toStatus;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(t);
      }

      const statusLabel = (s: string) =>
        s === 'reviewing' ? 'Reviewing' : 'Inbox';

      for (const [toStatus, transitions] of grouped) {
        const label = statusLabel(toStatus);
        const compFilter = toStatus as ComplianceFilter;
        const msg = transitions.length === 1
          ? `"${transitions[0].title}" moved to ${label}`
          : `${transitions.length} envelopes moved to ${label}`;
        showToast(msg, 'info', 5000, {
          label: 'View',
          onClick: () => folderView.setSidebarSelection('all', compFilter, 'active'),
        });
      }

      // Auto-expire transitions after 8 seconds
      const ids = newTransitions.map(t => t.envelopeId);
      setTimeout(() => {
        setFolderTransitions(prev => prev.filter(t => !ids.includes(t.envelopeId)));
      }, 8000);
    }
  }, [envelopes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive which folders should have pulsing count badges
  const pulseFolders = useMemo(() => ({
    drafts: folderTransitions.some(t => t.toStatus === 'drafts'),
    reviewing: folderTransitions.some(t => t.toStatus === 'reviewing'),
  }), [folderTransitions]);

  const fetchEnvelopes = useCallback(async () => {
    try {
      const response = await ApiClient.getEnvelopes();
      const list = response.envelopes || [];
      setEnvelopes(list);
      updateEnvelopeTitles(list);
    } catch (error) {
      console.error('Failed to fetch envelopes:', error);
    }
  }, [updateEnvelopeTitles]);

  const fetchArchivedEnvelopes = useCallback(async () => {
    try {
      const response = await ApiClient.getEnvelopes({ archived: true });
      const list = response.envelopes || [];
      setArchivedEnvelopes(list);
      updateEnvelopeTitles(list);
    } catch (error) {
      console.error('Failed to fetch archived envelopes:', error);
    }
  }, [updateEnvelopeTitles]);

  const fetchTags = useCallback(async () => {
    try {
      const response = await ApiClient.getTags();
      setTags(response.tags || []);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchEnvelopes(), fetchArchivedEnvelopes(), fetchTags()])
      .finally(() => setIsLoading(false));
  }, [fetchEnvelopes, fetchArchivedEnvelopes, fetchTags]);

  // Re-fetch when navigating back to the envelope list (e.g. after editing title in view page)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (location.pathname === '/envelopes') {
      fetchEnvelopes();
      fetchArchivedEnvelopes();
    }
  }, [location.pathname, fetchEnvelopes, fetchArchivedEnvelopes]);

  const createEnvelope = useCallback(async () => {
    try {
      const response = await ApiClient.createEnvelope({ title: '' });
      const newEnvelope = response.envelope;
      await fetchEnvelopes();
      navigate(`/envelopes/view?id=${newEnvelope.id}`);
    } catch (error) {
      console.error('Failed to create envelope:', error);
      showToast('Failed to create envelope', 'error');
    }
  }, [fetchEnvelopes, navigate]);

  const createEnvelopeWithFiles = useCallback(async (files: File[]) => {
    try {
      const title = files.map(f => f.name).join(' ').slice(0, 150);
      const response = await ApiClient.createEnvelope({ title });
      await fetchEnvelopes();
      navigate(`/envelopes/view?id=${response.envelope.id}`, { state: { initialFiles: files } });
    } catch (error) {
      console.error('Failed to create envelope:', error);
      showToast('Failed to create envelope', 'error');
    }
  }, [fetchEnvelopes, navigate]);

  const onToggleTag = useCallback(async (envelopeId: string, tagId: string) => {
    try {
      const envelope = envelopes.find(e => e.id === envelopeId);
      const hasTag = envelope?.tags?.some(t => t.id === tagId);
      if (hasTag) {
        await ApiClient.removeTagFromEnvelope(envelopeId, tagId);
      } else {
        await ApiClient.addTagsToEnvelope(envelopeId, [tagId]);
      }
      await fetchEnvelopes();
    } catch (error) {
      console.error('Failed to toggle tag:', error);
      showToast('Failed to update tag', 'error');
    }
  }, [envelopes, fetchEnvelopes]);

  const handleCreateTag = useCallback(async (name: string, color: TagColor, parentId?: string | null) => {
    try {
      await ApiClient.createTag({ name, color, parent_id: parentId });
      await fetchTags();
    } catch (error) {
      console.error('Failed to create tag:', error);
      showToast('Failed to create tag', 'error');
    }
  }, [fetchTags]);

  const handleUpdateTag = useCallback(async (id: string, data: { name?: string; color?: TagColor; parent_id?: string | null }) => {
    try {
      await ApiClient.updateTag(id, data);
      await fetchTags();
      await fetchEnvelopes(); // Tags on envelopes may have changed
    } catch (error) {
      console.error('Failed to update tag:', error);
      showToast('Failed to update tag', 'error');
    }
  }, [fetchTags, fetchEnvelopes]);

  const handleDeleteTag = useCallback(async (id: string) => {
    try {
      await ApiClient.deleteTag(id);
      await fetchTags();
      await fetchEnvelopes();
    } catch (error) {
      console.error('Failed to delete tag:', error);
      showToast('Failed to delete tag', 'error');
    }
  }, [fetchTags, fetchEnvelopes]);

  const starredCount = envelopes.filter(e => e.starred).length;
  // Cross-folder unread count — envelopes the user hasn't looked at
  // since their last relevant activity. Drives the sidebar's "Unread"
  // entry so users can see all attention-needing work in one view
  // instead of hopping between Inbox and Reviewing separately. Archived
  // envelopes excluded; blue-dot `unseen` flag is the source of truth.
  const unreadCount = envelopes.filter(e => (e as any).unseen === true && !e.archived_at).length;

  const handleSidebarSelect = useCallback((selection: { activeTab: string; complianceFilter: ComplianceFilter; archiveTab: ArchiveTab }) => {
    folderView.setSidebarSelection(selection.activeTab, selection.complianceFilter, selection.archiveTab);
    if (location.pathname !== '/envelopes') {
      navigate('/envelopes');
    }
  }, [folderView.setSidebarSelection, location.pathname, navigate]);

  const contextValue: EnvelopesLayoutContext = {
    envelopes,
    archivedEnvelopes,
    tags,
    isLoading,
    folderView,
    refreshEnvelopes: fetchEnvelopes,
    refreshTags: fetchTags,
    createEnvelope,
    createEnvelopeWithFiles,
    onToggleTag,
    toggleSidebar,
    sidebarCollapsed,
    registerInspection,
    unregisterInspection,
    folderTransitions,
    pulseFolders,
  };

  // --- DEV: compute active jobs from envelope list data + client-side inspections ---
  const activeJobs = useMemo(() => {
    if (!import.meta.env.DEV) return [];
    // Server-side active jobs (async mode)
    const serverJobs = [...envelopes, ...archivedEnvelopes]
      .filter(e => e.last_report?.job_status === 'pending' || e.last_report?.job_status === 'processing')
      .map(e => ({
        envelopeId: e.id,
        title: e.title || 'Untitled',
        status: e.last_report!.job_status as string,
      }));
    // Client-side inspections (covers sync mode in dev)
    const serverIds = new Set(serverJobs.map(j => j.envelopeId));
    const clientJobs = [...clientInspections.values()]
      .filter(j => !serverIds.has(j.envelopeId));
    return [...serverJobs, ...clientJobs];
  }, [envelopes, archivedEnvelopes, clientInspections]);

  return (
    <LayoutContext.Provider value={contextValue}>
      {import.meta.env.DEV && <DevJobsToolbar activeJobs={activeJobs} onRefresh={fetchEnvelopes} />}
      <div className="flex h-full min-h-0 flex-1">
        <EnvelopeListSidebar
          activeTab={folderView.activeTab}
          complianceFilter={folderView.complianceFilter}
          archiveTab={folderView.archiveTab}
          collapsed={sidebarCollapsed}
          folderStats={folderView.folderStats}
          tabs={folderView.tabs}
          tags={tags}
          recursiveTagCounts={folderView.recursiveTagCounts}
          starredCount={starredCount}
          archivedCount={archivedEnvelopes.length}
          unreadCount={unreadCount}
          unseenFolders={unseenFolders}
          processingFolders={processingFolders}
          pulseFolders={pulseFolders}
          onSidebarSelect={handleSidebarSelect}
          onCreateEnvelope={createEnvelope}
          onCreateEnvelopeWithFiles={createEnvelopeWithFiles}
          onManageTags={() => setTagManagementOpen(true)}
          onCreateTag={() => setNewLabelDialogOpen(true)}
        />
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          <Outlet />
        </div>
      </div>

      <TagManagementDialog
        open={tagManagementOpen}
        onOpenChange={setTagManagementOpen}
        tags={tags}
        onCreateTag={handleCreateTag}
        onUpdateTag={handleUpdateTag}
        onDeleteTag={handleDeleteTag}
      />

      <NewLabelDialog
        open={newLabelDialogOpen}
        onOpenChange={setNewLabelDialogOpen}
        tags={tags}
        onCreateTag={handleCreateTag}
      />
    </LayoutContext.Provider>
  );
}

// --- DEV-only toolbar showing active background jobs ---
function DevJobsToolbar({ activeJobs, onRefresh }: {
  activeJobs: { envelopeId: string; title: string; status: string; reportId?: string }[];
  onRefresh: () => Promise<void>;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Tick every second so we see live elapsed time
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-refresh envelope list every 10s when there are active jobs
  useEffect(() => {
    if (activeJobs.length === 0) return;
    const timer = setInterval(() => { onRefresh(); }, 10000);
    return () => clearInterval(timer);
  }, [activeJobs.length, onRefresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try { await onRefresh(); } finally { setIsRefreshing(false); }
  };

  return (
    <div className="flex-shrink-0 bg-amber-100 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 px-3 py-1 text-xs font-mono flex items-center gap-3">
      <span className="font-semibold text-amber-800 dark:text-amber-300">DEV</span>
      <span className="text-amber-700 dark:text-amber-400">
        {activeJobs.length === 0
          ? 'No active jobs'
          : `${activeJobs.length} active job${activeJobs.length > 1 ? 's' : ''}`}
      </span>
      {activeJobs.map(job => (
        <Link
          key={job.envelopeId}
          to={`/envelopes/view?id=${job.envelopeId}`}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-800 transition-colors"
        >
          <span className="inline-block h-2 w-2 rounded-full animate-pulse bg-blue-500" />
          <span className="truncate max-w-[150px]">{job.title}</span>
          <span className="text-amber-600 dark:text-amber-400">({job.status})</span>
        </Link>
      ))}
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="ml-auto px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors disabled:opacity-50"
        title="Refresh envelope list"
      >
        {isRefreshing ? '...' : '↻'}
      </button>
    </div>
  );
}
