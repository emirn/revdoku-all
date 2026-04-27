import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { ITag } from '@revdoku/lib';
import type { ComplianceFilter, FolderStats, FolderTab } from '@/lib/envelope-grouping';
import type { ArchiveTab } from '@/hooks/useFolderView';
import { buildTagTree, getAncestorIds, type TagTreeNode } from '@/lib/tag-tree';
import TagDot from '@/components/folders/TagDot';
import {
  Inbox, Star, Clock, Archive, Settings, Plus, Tag, X, Upload, ChevronDown, ChevronRight, FileText, LayoutList, Loader2, RefreshCw, History, Mail, MailOpen, Check, Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Link as RouterLink } from 'react-router-dom';
import { ApiClient } from '@/lib/api-client';

const EXPANDED_STORAGE_KEY = 'revdoku_label_tree_expanded';

function loadExpandedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveExpandedIds(ids: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

interface SidebarSelection {
  activeTab: string;
  complianceFilter: ComplianceFilter;
  archiveTab: ArchiveTab;
}

interface EnvelopeListSidebarProps {
  activeTab: string;
  complianceFilter: ComplianceFilter;
  archiveTab: ArchiveTab;
  collapsed: boolean;
  folderStats: FolderStats;
  tabs: FolderTab[];
  tags: ITag[];
  recursiveTagCounts: Record<string, number>;
  starredCount: number;
  archivedCount: number;
  /** Cross-folder count of unseen, non-archived envelopes — powers the
   *  "Unread" sidebar entry so users can see everything requiring
   *  attention in one view instead of hopping between Inbox / Reviewing. */
  unreadCount: number;
  unseenFolders?: { drafts: boolean; reviewing: boolean };
  processingFolders?: { drafts: boolean; reviewing: boolean };
  pulseFolders?: { drafts: boolean; reviewing: boolean };
  onSidebarSelect: (selection: SidebarSelection) => void;
  onCreateEnvelope: () => void;
  onCreateEnvelopeWithFiles?: (files: File[]) => void;
  onManageTags?: () => void;
  onCreateTag?: () => void;
}


interface SidebarViewItem {
  id: string;
  label: string;
  icon: React.ElementType;
  count: number;
  selection: SidebarSelection;
  unseenKey?: 'drafts' | 'reviewing';
  pulseKey?: 'drafts' | 'reviewing';
}

function isActiveItem(
  item: SidebarViewItem,
  activeTab: string,
  complianceFilter: ComplianceFilter,
  archiveTab: ArchiveTab
): boolean {
  return (
    item.selection.activeTab === activeTab &&
    item.selection.complianceFilter === complianceFilter &&
    item.selection.archiveTab === archiveTab
  );
}

const EnvelopeListSidebar = React.memo(function EnvelopeListSidebar({
  activeTab,
  complianceFilter,
  archiveTab,
  collapsed,
  folderStats,
  tabs,
  tags,
  recursiveTagCounts,
  starredCount,
  archivedCount,
  unreadCount,
  unseenFolders,
  processingFolders,
  pulseFolders,
  onSidebarSelect,
  onCreateEnvelope,
  onCreateEnvelopeWithFiles,
  onManageTags,
  onCreateTag,
}: EnvelopeListSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(loadExpandedIds);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
// Build tag tree
  const tagTree = useMemo(() => buildTagTree(tags), [tags]);

  // Auto-expand ancestors of activeTab so the selected label is always visible
  useEffect(() => {
    if (!activeTab || activeTab === 'all' || activeTab === 'starred' || activeTab === 'untagged') return;
    const ancestors = getAncestorIds(tags, activeTab);
    if (ancestors.size === 0) return;
    setExpandedIds(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      if (!changed) return prev;
      saveExpandedIds(next);
      return next;
    });
  }, [activeTab, tags]);

  // Open mobile drawer when burger button is clicked on small screens
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth < 1024) {
        setMobileOpen(prev => !prev);
      }
    };
    document.addEventListener('sidebar:toggle', handler);
    return () => document.removeEventListener('sidebar:toggle', handler);
  }, []);

  const handleOpenFilePicker = () => fileInputRef.current?.click();
  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onCreateEnvelopeWithFiles) {
      onCreateEnvelopeWithFiles(files);
      setMobileOpen(false);
    }
    e.target.value = '';
  };

  const toggleExpand = useCallback((tagId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      saveExpandedIds(next);
      return next;
    });
  }, []);

  const allCount = folderStats.complianceStats.drafts + folderStats.complianceStats.reviewing;
  const recentCount = Math.min(12, allCount);

  const viewItems: SidebarViewItem[] = [
    {
      id: 'all-envelopes', label: 'All', icon: LayoutList, count: allCount,
      selection: { activeTab: 'all', complianceFilter: 'all', archiveTab: 'active' }
    },
    {
      id: 'starred', label: 'Starred', icon: Star, count: starredCount,
      selection: { activeTab: 'starred', complianceFilter: 'all', archiveTab: 'active' }
    },
    {
      id: 'recent', label: 'Recent', icon: History, count: recentCount,
      selection: { activeTab: 'recent', complianceFilter: 'all', archiveTab: 'active' }
    },
    {
      // Sits above the separator alongside All / Starred / Recent as a
      // cross-folder "find what needs my attention" view. Mirrors the
      // per-folder blue-dot unread signal already shown on Inbox and
      // Reviewing, aggregated into one clickable surface.
      id: 'unread', label: 'Unread', icon: MailOpen, count: unreadCount,
      selection: { activeTab: 'unread', complianceFilter: 'all', archiveTab: 'active' }
    },
    {
      id: 'inbox', label: 'Inbox', icon: Inbox, count: folderStats.complianceStats.drafts, unseenKey: 'drafts', pulseKey: 'drafts',
      selection: { activeTab: 'all', complianceFilter: 'drafts', archiveTab: 'active' }
    },
    {
      id: 'in-work', label: 'Reviewing', icon: Clock, count: folderStats.complianceStats.reviewing, unseenKey: 'reviewing', pulseKey: 'reviewing',
      selection: { activeTab: 'all', complianceFilter: 'reviewing', archiveTab: 'active' }
    },
    {
      id: 'revised', label: 'Revised', icon: RefreshCw, count: folderStats.complianceStats.followUpReview,
      selection: { activeTab: 'all', complianceFilter: 'revised', archiveTab: 'active' }
    },
    {
      id: 'archived', label: 'Archived', icon: Archive, count: archivedCount,
      selection: { activeTab: 'all', complianceFilter: 'all', archiveTab: 'archived' }
    },
  ];

  const isLabelActive = (tagId: string) =>
    activeTab === tagId && complianceFilter === 'all' && archiveTab === 'active';
  const isUntaggedActive =
    activeTab === 'untagged' && complianceFilter === 'all' && archiveTab === 'active';
  const untaggedTab = tabs.find(t => t.id === 'untagged');

  const handleSelect = (selection: SidebarSelection) => {
    onSidebarSelect(selection);
    setMobileOpen(false);
  };

  // Render a single tag tree item (recursive)
  const renderTagTreeItem = useCallback((node: TagTreeNode) => {
    const active = isLabelActive(node.tag.id);
    const count = recursiveTagCounts[node.tag.id] ?? 0;
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.tag.id);

    return (
      <React.Fragment key={node.tag.id}>
        <li>
          <button
            onClick={() => handleSelect({ activeTab: node.tag.id, complianceFilter: 'all', archiveTab: 'active' })}
            className={`w-full flex items-center gap-2 py-1.5 rounded-lg text-sm transition-colors ${active ? 'bg-muted font-semibold text-foreground' : 'text-foreground hover:bg-muted'}`}
            style={{ paddingLeft: 12 + node.depth * 16, paddingRight: 12 }}
          >
            {/* Chevron only renders for tags that actually have children
                — leaves (the 99% case) use no reserved space so their
                TagDot aligns flush with the folder icons above. For
                parents the chevron is pulled slightly left (-ml-0.5) so
                it reads as a disclosure affordance living in the left
                padding rather than adding to the main content indent,
                Gmail-style. */}
            {hasChildren && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.tag.id); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleExpand(node.tag.id);
                  }
                }}
                className="flex-shrink-0 -ml-0.5 p-0 hover:bg-muted-foreground/10 rounded cursor-pointer"
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </span>
            )}
            <TagDot color={node.tag.color} size="lg" name={node.tag.name} showLetter />
            <span className="flex-1 text-left truncate">{node.tag.name}</span>
            {count > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
            )}
          </button>
        </li>
        {hasChildren && isExpanded && node.children.map(child => renderTagTreeItem(child))}
      </React.Fragment>
    );
  }, [activeTab, complianceFilter, archiveTab, expandedIds, recursiveTagCounts, toggleExpand]);

  // --- Collapsed (icon-only) sidebar ---
  if (collapsed) {
    // In collapsed mode, show only root-level tags (Gmail behavior)
    const rootTags = tagTree.map(n => n.tag);
    return (
      <aside className="hidden lg:flex lg:flex-col w-[68px] border-r border-border bg-background flex-shrink-0 items-center py-3 gap-1">
        {/* Circular open-file button */}
        <button
          onClick={handleOpenFilePicker}
          className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:shadow-lg transition-shadow mb-2"
          title="Open File"
        >
          <Upload className="h-5 w-5" />
        </button>
        <input ref={fileInputRef} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" onChange={handleFilesPicked} />

        {/* View items — icon only with badge */}
        {viewItems.map((item, idx) => {
          const active = isActiveItem(item, activeTab, complianceFilter, archiveTab);
          const Icon = item.icon;
          const hasUnseen = item.unseenKey && unseenFolders?.[item.unseenKey];
          const isProcessing = item.unseenKey && processingFolders?.[item.unseenKey];
          return (
            <React.Fragment key={item.id}>
              <button
                onClick={() => handleSelect(item.selection)}
                className={`relative w-12 h-10 rounded-full flex items-center justify-center transition-colors ${active
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                  : 'text-muted-foreground hover:bg-muted'
                  }`}
                title={`${item.label}${item.count > 0 ? ` (${item.count})` : ''}${isProcessing ? ' (processing)' : ''}`}
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> : <Icon className="h-5 w-5" />}
                {hasUnseen && !isProcessing && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-indigo-500 rounded-full" />
                )}
              </button>
              {idx === 3 && <div className="border-t border-border w-8 my-0.5" />}
            </React.Fragment>
          );
        })}

        {/* Divider */}
        <div className="border-t border-border w-8 my-1" />

        {/* Label items — icon only with badge (roots only) */}
        {rootTags.map(tag => {
          const active = isLabelActive(tag.id);
          const count = recursiveTagCounts[tag.id] ?? 0;
          return (
            <button
              key={tag.id}
              onClick={() => handleSelect({ activeTab: tag.id, complianceFilter: 'all', archiveTab: 'active' })}
              className={`relative w-12 h-10 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              title={`${tag.name}${count > 0 ? ` (${count})` : ''}`}
            >
              <TagDot color={tag.color} size="lg" name={tag.name} showLetter />
              {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full" />
              )}
            </button>
          );
        })}

        {/* Create label */}
        {onCreateTag && (
          <>
            <div className="border-t border-border w-8 my-1" />
            <button
              onClick={onCreateTag}
              className="w-12 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
              title="Create new label"
            >
              <Plus className="h-5 w-5" />
            </button>
          </>
        )}
      </aside>
    );
  }

  // --- Expanded sidebar content (shared between desktop and mobile drawer) ---
  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <div className="flex w-full">
          <Button
            onClick={() => { handleOpenFilePicker(); }}
            className="flex-1 justify-start gap-2 text-sm font-medium shadow-sm rounded-r-none"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            Open File
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="px-1.5 rounded-l-none border-l border-primary-foreground/20 shadow-sm">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => { handleOpenFilePicker(); }}>
                <Upload className="h-4 w-4 mr-2" />
                Open File...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { onCreateEnvelope(); setMobileOpen(false); }}>
                <FileText className="h-4 w-4 mr-2" />
                Empty Envelope
              </DropdownMenuItem>
              </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <input ref={fileInputRef} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" onChange={handleFilesPicked} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        <ul className="space-y-0.5">
          {viewItems.map((item, idx) => {
            const active = isActiveItem(item, activeTab, complianceFilter, archiveTab);
            const Icon = item.icon;
            const hasUnseen = item.unseenKey && unseenFolders?.[item.unseenKey];
            const isProcessing = item.unseenKey && processingFolders?.[item.unseenKey];
            return (
              <React.Fragment key={item.id}>
                <li>
                  <button
                    onClick={() => handleSelect(item.selection)}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${active
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'text-foreground hover:bg-muted'
                      }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {isProcessing && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 flex-shrink-0" />
                    )}
                    {hasUnseen && !isProcessing && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                    )}
                    {item.count > 0 && (
                      <span
                        key={item.pulseKey && pulseFolders?.[item.pulseKey] ? `pulse-${Date.now()}` : undefined}
                        className={`text-xs tabular-nums ${active ? 'font-semibold' : 'text-muted-foreground'} ${item.pulseKey && pulseFolders?.[item.pulseKey] ? 'count-pulse' : ''}`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                </li>
                {idx === 3 && <li className="border-t border-border mx-3 my-1" />}
              </React.Fragment>
            );
          })}
        </ul>

        <div className="border-t border-border my-3 mx-1" />

        <div className="space-y-0.5">
          {onManageTags && (
            <button
              onClick={() => { onManageTags(); setMobileOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4 flex-shrink-0" />
              Manage Labels
            </button>
          )}
        </div>

        {(onCreateTag || tags.length > 0) && (
          <>
            <div className="border-t border-border my-3 mx-1" />
            <div className="flex items-center justify-between px-3 mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Labels</span>
              {onCreateTag && (
                <button
                  onClick={() => { onCreateTag(); setMobileOpen(false); }}
                  className="w-6 h-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Create new label"
                  aria-label="Create new label"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {tags.length > 0 && (
              <ul className="space-y-0.5">
                {tagTree.map(rootNode => renderTagTreeItem(rootNode))}
                {untaggedTab && untaggedTab.count > 0 && (
                  <li>
                    <button
                      onClick={() => handleSelect({ activeTab: 'untagged', complianceFilter: 'all', archiveTab: 'active' })}
                      className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${isUntaggedActive ? 'bg-muted font-semibold text-foreground' : 'text-foreground hover:bg-muted'
                        }`}
                    >
                      <Tag className="h-4 w-4 flex-shrink-0 text-gray-400" />
                      <span className="flex-1 text-left">Untagged</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{untaggedTab.count}</span>
                    </button>
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </nav>
    </div>
  );

  return (
    <>
      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-64 bg-background border-r border-border shadow-lg flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="font-semibold text-sm">Envelopes</span>
              <button onClick={() => setMobileOpen(false)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebarContent}
          </div>
          <div className="flex-1 bg-black/20" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Desktop expanded sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 border-r border-border bg-background flex-shrink-0">
        {sidebarContent}
      </aside>

      </>
  );
});

export default EnvelopeListSidebar;
