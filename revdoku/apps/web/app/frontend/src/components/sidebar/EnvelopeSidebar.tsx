import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Search, ChevronDown, List, RefreshCw } from 'lucide-react';
import { useSidebarEnvelopes, type SidebarSection as SidebarSectionData } from './useSidebarEnvelopes';
import { SidebarEnvelopeItem } from './SidebarEnvelopeItem';

const STORAGE_KEY_COLLAPSED = 'revdoku_sidebar_collapsed';
const STORAGE_KEY_SECTIONS = 'revdoku_sidebar_sections';

interface EnvelopeSidebarProps {
  currentEnvelopeId: string | null;
  onSelectEnvelope: (prefixId: string) => void;
}

export function EnvelopeSidebar({ currentEnvelopeId, onSelectEnvelope }: EnvelopeSidebarProps) {
  const navigate = useNavigate();
  const { sections, isLoading, error, refetch, searchQuery, setSearchQuery } = useSidebarEnvelopes();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_COLLAPSED) !== 'false'; } catch { return true; }
  });

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SECTIONS);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Persist collapsed state
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed)); } catch (e) { console.warn('Failed to save sidebar collapsed state:', e); }
  }, [collapsed]);

  // Persist section collapse state
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_SECTIONS, JSON.stringify(collapsedSections)); } catch (e) { console.warn('Failed to save section collapse state:', e); }
  }, [collapsedSections]);

  // Issue #1: Memoize flat list of visible envelope IDs for keyboard nav
  const flatList = useMemo(
    () => sections
      .filter(s => !collapsedSections[s.key])
      .flatMap(s => s.envelopes.map(e => e.prefixId)),
    [sections, collapsedSections]
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Issue #2: Scroll active envelope into view when sidebar expands or on mount
  useEffect(() => {
    if (collapsed || !currentEnvelopeId) return;
    // Small delay to let DOM render
    const timer = setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-envelope-id="${currentEnvelopeId}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 50);
    return () => clearTimeout(timer);
  }, [collapsed, currentEnvelopeId, sections]);

  // Issue #3: Scroll focused item into view when focusIndex changes
  useEffect(() => {
    if (focusIndex < 0 || focusIndex >= flatList.length) return;
    const prefixId = flatList[focusIndex];
    const el = scrollContainerRef.current?.querySelector(`[data-envelope-id="${prefixId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, flatList]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Issue #5: / to focus search (Gmail pattern)
      if (e.key === '/' && !isInput && !collapsed) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (e.key === '[' && !isInput) {
        e.preventDefault();
        setCollapsed(c => !c);
        return;
      }

      if (collapsed || isInput) return;

      if (e.key === 'j') {
        e.preventDefault();
        setFocusIndex(i => Math.min(i + 1, flatList.length - 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setFocusIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < flatList.length) {
        e.preventDefault();
        onSelectEnvelope(flatList[focusIndex]);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [collapsed, flatList, focusIndex, onSelectEnvelope]);

  // Reset focus when list changes
  useEffect(() => { setFocusIndex(-1); }, [searchQuery]);

  const totalCount = sections.reduce((sum, s) => sum + s.envelopes.length, 0);

  // Issue #10 + #11: Single container with transition instead of early return.
  // On mobile (< lg), hide collapsed strip entirely — sidebar is a desktop power-user feature.
  return (
    <>
      {/* Issue #4: Backdrop with transition-opacity for smooth mobile dismiss */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/20 z-30 lg:hidden animate-in fade-in duration-150"
          onClick={() => setCollapsed(true)}
        />
      )}

      <div
        className={`
          shrink-0 flex flex-col border-r border-border bg-background transition-all duration-200 overflow-hidden
          ${collapsed
            ? 'w-0 lg:w-10 bg-muted/30'
            : 'fixed left-0 top-16 bottom-0 z-40 w-64 lg:static lg:z-auto'
          }
        `}
      >
        {/* Collapsed state: thin toggle strip (desktop only via w-0/lg:w-10) */}
        {collapsed && (
          <div className="flex flex-col items-center pt-2">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
              title="Expand sidebar (press [)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Expanded state */}
        {!collapsed && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Envelopes</span>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground"
                title="Collapse sidebar (press [)"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-2 py-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Filter... (press /)"
                  className="w-full pl-7 pr-2 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {/* Sections */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-1">
              {isLoading ? (
                <div className="text-sm text-muted-foreground text-center py-4">Loading...</div>
              ) : error ? (
                /* Issue #8: Error state with retry */
                <div className="text-sm text-center py-4 space-y-2">
                  <div className="text-muted-foreground">Failed to load</div>
                  <button
                    type="button"
                    onClick={refetch}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                </div>
              ) : totalCount === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  {searchQuery ? 'No matches' : 'No envelopes'}
                </div>
              ) : (
                sections.map(section => (
                  <SidebarSectionView
                    key={section.key}
                    section={section}
                    isCollapsed={!!collapsedSections[section.key]}
                    onToggle={() => toggleSection(section.key)}
                    currentEnvelopeId={currentEnvelopeId}
                    focusedPrefixId={focusIndex >= 0 ? flatList[focusIndex] : null}
                    onSelectEnvelope={onSelectEnvelope}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-3 py-2">
              <button
                type="button"
                onClick={() => navigate('/envelopes')}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <List className="h-3.5 w-3.5" />
                View all envelopes
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function SidebarSectionView({
  section,
  isCollapsed,
  onToggle,
  currentEnvelopeId,
  focusedPrefixId,
  onSelectEnvelope,
}: {
  section: SidebarSectionData;
  isCollapsed: boolean;
  onToggle: () => void;
  currentEnvelopeId: string | null;
  focusedPrefixId: string | null;
  onSelectEnvelope: (prefixId: string) => void;
}) {
  if (section.envelopes.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground uppercase tracking-wide"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
        <span className="flex-1 text-left">{section.label}</span>
        <span className="text-[10px] tabular-nums bg-muted rounded px-1">{section.envelopes.length}</span>
      </button>
      {!isCollapsed && (
        <div className="space-y-0.5 mt-0.5">
          {section.envelopes.map(env => (
            <SidebarEnvelopeItem
              key={env.prefixId}
              envelope={env}
              isActive={currentEnvelopeId === env.prefixId}
              isFocused={focusedPrefixId === env.prefixId}
              onSelect={onSelectEnvelope}
            />
          ))}
        </div>
      )}
    </div>
  );
}
