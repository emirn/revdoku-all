import { useEffect, useState, useMemo, useRef } from 'react';
import { Paperclip, Loader2, Upload, FileText, Image as ImageIcon, ArrowUpDown, Search, Info, Trash2, AlertTriangle } from 'lucide-react';
import { apiRequest, apiJsonResponse } from '@/config/api';
import { ApiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { RefFileViewer } from '@/components/envelope-page/HighlightOverlay';

// "Library" — reusable reference documents that checklists can attach
// via `#ref[...]` markers. Backend concept already uses this term:
// DocumentFile.library scope, save_to_library flag, /files/copy_to_library
// endpoint. UI was historically labelled "Ref Files"; renamed to
// "Library" for consistency with the data model and a cleaner name.
// Backend API still lives under /api/v1/files — only the UI route
// changed to /library.

interface LibraryFile {
  prefix_id: string;
  library: boolean;
  latest_revision: {
    prefix_id: string;
    revision_number: number;
    name: string;
    mime_type: string;
    byte_size: number;
    ready: boolean;
    uploaded_at: string;
  };
}

type SortKey = 'name' | 'uploaded' | 'size' | 'type';
type SortDir = 'asc' | 'desc';

export default function LibraryPage() {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('uploaded');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [mimeFilter, setMimeFilter] = useState<string>('');
  // State shape mirrors what the shared RefFileViewer expects on the
  // envelope page. We reuse the same component here for visual parity —
  // the library just doesn't emit beams (suppressBeams) and never drives
  // a save-to-library flow (all files are already in the library). The
  // viewer portals itself to document.body, so this element can live
  // anywhere inside the page tree.
  type ViewerState = Parameters<typeof RefFileViewer>[0]['state'];
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const viewerGenRef = useRef(0);
  // Delete-confirmation modal state. Closing the modal (null) never
  // deletes; only the explicit "Delete" button in the confirmation dialog
  // calls the API. Mid-call the button shows a spinner and everything
  // stays disabled so the same click can't double-fire.
  const [pendingDelete, setPendingDelete] = useState<LibraryFile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest('/files');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await apiJsonResponse(res) as { files: LibraryFile[] };
      setFiles(body.files || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await ApiClient.uploadFile({ file, save_in_library: true });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Click a row → open RefFileViewer (the same floating viewer used on
  // the envelope page). The viewer needs base64 content + pose + the
  // full envelope-context shape; we supply library-appropriate defaults
  // (no beams, no source check, already-saved badge, no highlight target).
  const openViewer = async (f: LibraryFile) => {
    const dfrevPrefixId = f.latest_revision.prefix_id;
    const myGen = ++viewerGenRef.current;

    // Size/position the floating panel: roughly 70% × 80% of the viewport,
    // anchored slightly left-of-center to leave the library list visible.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.max(280, Math.min(vw - 32, Math.round(vw * 0.7)));
    const height = Math.max(240, Math.min(vh - 32, Math.round(vh * 0.8)));
    const x = Math.round((vw - width) / 2);
    const y = Math.round((vh - height) / 2);

    setViewer({
      dfrevId: dfrevPrefixId,
      name: f.latest_revision.name,
      mimeType: f.latest_revision.mime_type,
      originalBase64: null,
      textContent: '',
      activeTab: 'original',
      scopeLabel: 'Library file',
      loading: true,
      loadError: null,
      x, y, width, height,
      highlightValue: null,
      refPage: null,
      anchor: null,
      highlightAnchor: null,
      sourceCheckId: null,
      citationKey: null,
      savingToLibrary: false,
      savedToLibrary: true, // library listing — already in library by definition
      visible: true,
    });

    try {
      const { content } = await ApiClient.getDocumentFileRevisionContent(dfrevPrefixId);
      if (viewerGenRef.current !== myGen) return;
      setViewer((prev) => (prev ? { ...prev, originalBase64: content, loading: false } : prev));
    } catch (e: any) {
      if (viewerGenRef.current !== myGen) return;
      setViewer((prev) => (prev ? { ...prev, loading: false, loadError: e?.message || 'Failed to load file' } : prev));
    }
  };

  // Drag/resize hooks wired to the same pose fields. Minimal implementation:
  // no cross-session persistence, no snap zones. Mirrors the envelope-page
  // handlers' public shape (mouse delta → updated x/y or w/h in viewer state)
  // but lives here since we don't need the persistence that useRefViewerPose
  // provides inside HighlightOverlay.
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!viewer) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanelX = viewer.x;
    const startPanelY = viewer.y;
    const move = (ev: MouseEvent) => {
      setViewer((prev) => (prev ? { ...prev, x: startPanelX + (ev.clientX - startX), y: startPanelY + (ev.clientY - startY) } : prev));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onResizeStart = (e: React.MouseEvent, corner: 'se' | 'sw' | 'ne' | 'nw') => {
    e.preventDefault();
    e.stopPropagation();
    if (!viewer) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = viewer.width;
    const startH = viewer.height;
    const startPanelX = viewer.x;
    const startPanelY = viewer.y;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setViewer((prev) => {
        if (!prev) return prev;
        let nextW = prev.width;
        let nextH = prev.height;
        let nextX = prev.x;
        let nextY = prev.y;
        if (corner === 'se') { nextW = Math.max(280, startW + dx); nextH = Math.max(240, startH + dy); }
        else if (corner === 'sw') { nextW = Math.max(280, startW - dx); nextH = Math.max(240, startH + dy); nextX = startPanelX + (startW - nextW); }
        else if (corner === 'ne') { nextW = Math.max(280, startW + dx); nextH = Math.max(240, startH - dy); nextY = startPanelY + (startH - nextH); }
        else if (corner === 'nw') { nextW = Math.max(280, startW - dx); nextH = Math.max(240, startH - dy); nextX = startPanelX + (startW - nextW); nextY = startPanelY + (startH - nextH); }
        return { ...prev, x: nextX, y: nextY, width: nextW, height: nextH };
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Delete requested from a row. Before we actually DELETE, the server
  // refuses if the file is currently pinned to any envelope revision
  // (DocumentFile.guard_referenced_by_ref_files). The confirmation
  // dialog surfaces that error inline when it happens.
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const prefixId = pendingDelete.prefix_id;
    setDeletingId(prefixId);
    setDeleteError(null);
    try {
      await ApiClient.deleteLibraryFile(prefixId);
      setFiles((prev) => prev.filter((f) => f.prefix_id !== prefixId));
      setPendingDelete(null);
    } catch (e: any) {
      setDeleteError(e?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const mimeTypes = useMemo(() => {
    const set = new Set(files.map(f => f.latest_revision.mime_type));
    return Array.from(set).sort();
  }, [files]);

  const filtered = useMemo(() => {
    let list = files;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(f => f.latest_revision.name.toLowerCase().includes(q));
    }
    if (mimeFilter) {
      list = list.filter(f => f.latest_revision.mime_type === mimeFilter);
    }
    list = [...list].sort((a, b) => {
      const ra = a.latest_revision;
      const rb = b.latest_revision;
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = ra.name.localeCompare(rb.name); break;
        case 'uploaded': cmp = ra.uploaded_at.localeCompare(rb.uploaded_at); break;
        case 'size': cmp = ra.byte_size - rb.byte_size; break;
        case 'type': cmp = ra.mime_type.localeCompare(rb.mime_type); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [files, query, mimeFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const mimeIcon = (mime: string) => {
    if (mime.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-indigo-500" />;
    return <FileText className="h-4 w-4 text-indigo-500" />;
  };

  const mimeLabel = (mime: string) => {
    const map: Record<string, string> = {
      'text/csv': 'CSV', 'text/plain': 'TXT',
      'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG',
    };
    return map[mime] || mime;
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={`text-[11px] px-1.5 py-0.5 rounded ${sortKey === k ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium' : 'text-muted-foreground hover:bg-muted'}`}
    >
      {label}{sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Header — title block on the left, upload button on the right.
          `flex-wrap items-start gap-3` ensures the button never overlaps
          or clips the title/description when the viewport narrows or
          the sidebar eats horizontal space — it simply wraps to a new
          line instead. `min-w-0 flex-1` on the title block lets the
          description wrap cleanly. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Paperclip className="h-5 w-5 text-indigo-500" />
            Library
          </h1>
          <p className="text-sm text-muted-foreground">
            Reusable reference documents for your account are stored here.
          </p>
          <div className="mt-2 flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <div className="space-y-1">
              <div>
                To reference a library in a checklist, type{' '}
                <code className="bg-white/70 dark:bg-indigo-950/60 px-1 rounded">#ref[file:&lt;fileid&gt;]</code>{' '}
                and pick the file from the list
              </div>
              <div className="text-indigo-800/80 dark:text-indigo-300/80">
                Files saved to Library shows below. Click on a file to preview.
              </div>
            </div>
          </div>
        </div>
        <label className="inline-flex shrink-0">
          <input
            type="file"
            className="hidden"
            accept=".csv,.txt,.md,.pdf,.png,.jpg,.jpeg,text/csv,text/plain,text/markdown,application/pdf,image/png,image/jpeg"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button asChild variant="default" className="gap-1.5 bg-indigo-600 hover:bg-indigo-700" disabled={uploading}>
            <span className="cursor-pointer">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? 'Uploading…' : 'Add File'}
            </span>
          </Button>
        </label>
      </div>

      {error && (
        <div className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 px-3 py-2">
          {error}
        </div>
      )}

      {/* Filter + sort bar */}
      {!loading && files.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter by name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1 text-sm border border-border rounded bg-background text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {mimeTypes.length > 1 && (
            <select
              value={mimeFilter}
              onChange={e => setMimeFilter(e.target.value)}
              className="text-xs py-1 px-2 border border-border rounded bg-background text-foreground"
            >
              <option value="">All types</option>
              {mimeTypes.map(m => <option key={m} value={m}>{mimeLabel(m)}</option>)}
            </select>
          )}
          <div className="flex items-center gap-0.5 ml-auto">
            <ArrowUpDown className="h-3 w-3 text-muted-foreground mr-1" />
            <SortBtn k="uploaded" label="Date" />
            <SortBtn k="name" label="Name" />
            <SortBtn k="size" label="Size" />
            <SortBtn k="type" label="Type" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          Your library is empty. Upload a CSV, TXT, PDF, PNG or JPG to get started.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          No files match your filter.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {filtered.map((f) => (
              <li
                key={f.prefix_id}
                className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => openViewer(f)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openViewer(f);
                  }
                }}
              >
                {mimeIcon(f.latest_revision.mime_type)}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.latest_revision.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {mimeLabel(f.latest_revision.mime_type)} · {formatBytes(f.latest_revision.byte_size)} · v{f.latest_revision.revision_number + 1} · {formatDate(f.latest_revision.uploaded_at)}
                  </div>
                </div>
                <code className="text-[11px] text-muted-foreground/70 hidden sm:inline">file:{f.prefix_id}</code>
                <button
                  type="button"
                  onClick={(e) => {
                    // Don't let the row click open the viewer at the same time.
                    e.stopPropagation();
                    setPendingDelete(f);
                    setDeleteError(null);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                  title="Delete file"
                  aria-label={`Delete ${f.latest_revision.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {filtered.length} file{filtered.length !== 1 ? 's' : ''}{filtered.length !== files.length ? ` (of ${files.length})` : ''}
          </p>
        </>
      )}

      {viewer && viewer.visible && (
        <RefFileViewer
          state={viewer}
          minWidth={280}
          minHeight={240}
          overlayContainer={null}
          suppressBeams
          onDragStart={onDragStart}
          onResizeStart={onResizeStart}
          onClose={() => setViewer((prev) => (prev ? { ...prev, visible: false } : prev))}
          onTabChange={(tab) => setViewer((prev) => (prev ? { ...prev, activeTab: tab } : prev))}
          onSaveToLibrary={() => { /* library files are already in the library */ }}
        />
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && deletingId == null) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete library file?
            </DialogTitle>
            <DialogDescription className="pt-2">
              <span className="font-medium text-foreground">{pendingDelete?.latest_revision.name}</span> will be permanently removed from your library.
              Any checklist rule that references it via <code className="text-xs bg-muted px-1 rounded">#ref[file:{pendingDelete?.prefix_id}]</code> will stop resolving.
              Files currently pinned to an envelope revision can't be deleted — remove those revisions first.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="text-sm rounded-md border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 px-3 py-2">
              {deleteError}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setPendingDelete(null); setDeleteError(null); }}
              disabled={deletingId != null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deletingId != null}
              className="gap-1.5"
            >
              {deletingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {deletingId ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
