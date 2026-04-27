import type { IEnvelope, ITag, TagColor } from '@revdoku/lib';
import { getSelfAndDescendantIds } from '@/lib/tag-tree';

export type ComplianceFilter = 'all' | 'drafts' | 'reviewing' | 'revised';

export interface FolderTab {
  id: string;    // tag ID, 'all', 'starred', 'recent', 'untagged', or 'drafts'
  label: string;
  count: number;
  color?: TagColor;
}

export interface GroupedEnvelopes {
  tagFolders: Map<string, {
    tag: ITag;
    envelopes: IEnvelope[];
  }>;
  specialFolders: {
    untagged: IEnvelope[];
  };
}

export interface FolderStats {
  totalEnvelopes: number;
  tagFoldersCount: number;
  specialFoldersCount: number;
  complianceStats: {
    drafts: number;
    reviewing: number;
    followUpReview: number;
  };
}

/**
 * Gets the compliance status of an envelope.
 * An envelope is `reviewing` as soon as it has any report; otherwise `drafts`.
 */
export function getEnvelopeComplianceStatus(envelope: IEnvelope & { last_report?: any }): 'drafts' | 'reviewing' {
  if (envelope.last_report) return 'reviewing';
  const hasReport = envelope.envelope_revisions?.some(rev => rev.report);
  return hasReport ? 'reviewing' : 'drafts';
}

/**
 * Filters envelopes by compliance status
 */
export function filterEnvelopesByCompliance(
  envelopes: IEnvelope[],
  filter: ComplianceFilter
): IEnvelope[] {
  if (filter === 'all') return envelopes;

  if (filter === 'revised') {
    return envelopes.filter(envelope => {
      const status = getEnvelopeComplianceStatus(envelope);
      return status === 'reviewing' && (envelope.current_revision_index ?? 0) >= 1;
    });
  }

  return envelopes.filter(envelope => {
    const status = getEnvelopeComplianceStatus(envelope);
    return status === filter;
  });
}

/**
 * Groups envelopes by their assigned tags.
 * Many-to-many: an envelope appears in every tag folder it belongs to.
 * Envelopes with no tags go into the 'untagged' folder.
 */
export function groupEnvelopesByTag(
  envelopes: IEnvelope[],
  tags: ITag[],
  complianceFilter: ComplianceFilter = 'all'
): GroupedEnvelopes {
  const filteredEnvelopes = filterEnvelopesByCompliance(envelopes, complianceFilter);

  const tagFolders = new Map<string, { tag: ITag; envelopes: IEnvelope[] }>();
  const untagged: IEnvelope[] = [];

  // Pre-create folders for all known tags (so empty tags still show up)
  tags.forEach(tag => {
    tagFolders.set(tag.id, { tag, envelopes: [] });
  });

  filteredEnvelopes.forEach(envelope => {
    const envelopeTags = envelope.tags || [];

    if (envelopeTags.length === 0) {
      untagged.push(envelope);
      return;
    }

    let placed = false;
    envelopeTags.forEach(envTag => {
      const folder = tagFolders.get(envTag.id);
      if (folder) {
        folder.envelopes.push(envelope);
        placed = true;
      }
    });

    // If none of the envelope's tags match known tags, treat as untagged
    if (!placed) {
      untagged.push(envelope);
    }
  });

  return {
    tagFolders,
    specialFolders: { untagged }
  };
}

/**
 * Calculates folder statistics for display
 */
export function calculateFolderStats(groupedEnvelopes: GroupedEnvelopes, allEnvelopes?: IEnvelope[]): FolderStats {
  const { tagFolders, specialFolders } = groupedEnvelopes;

  // Count unique envelopes (since an envelope can appear in multiple tag folders)
  const seenIds = new Set<string>();
  tagFolders.forEach(folder => {
    folder.envelopes.forEach(e => seenIds.add(e.id));
  });
  specialFolders.untagged.forEach(e => seenIds.add(e.id));

  const totalEnvelopes = seenIds.size;
  const tagFoldersCount = tagFolders.size;
  const specialFoldersCount = specialFolders.untagged.length > 0 ? 1 : 0;

  let complianceStats = { drafts: 0, reviewing: 0, followUpReview: 0 };

  if (allEnvelopes) {
    allEnvelopes.forEach(envelope => {
      const status = getEnvelopeComplianceStatus(envelope);
      complianceStats[status]++;
      if (status === 'reviewing' && (envelope.current_revision_index ?? 0) >= 1) {
        complianceStats.followUpReview++;
      }
    });
  }

  return {
    totalEnvelopes,
    tagFoldersCount,
    specialFoldersCount,
    complianceStats
  };
}

/**
 * Sorts envelopes with starred items first, preserving relative order within each group.
 */
export function sortStarredFirst(envelopes: IEnvelope[]): IEnvelope[] {
  return [...envelopes].sort((a, b) => {
    const aStarred = a.starred ? 1 : 0;
    const bStarred = b.starred ? 1 : 0;
    return bStarred - aStarred;
  });
}

const RECENT_MAX_COUNT = 12;

/**
 * Builds the list of tabs from grouped envelopes.
 * Pass allEnvelopes (unfiltered) to enable Starred and Recent tabs.
 */
export function buildTabs(
  groupedEnvelopes: GroupedEnvelopes,
  allEnvelopes?: IEnvelope[]
): FolderTab[] {
  const tabs: FolderTab[] = [];

  // "All" tab — count unique envelopes
  const seenIds = new Set<string>();
  groupedEnvelopes.tagFolders.forEach(folder => {
    folder.envelopes.forEach(e => seenIds.add(e.id));
  });
  groupedEnvelopes.specialFolders.untagged.forEach(e => seenIds.add(e.id));
  tabs.push({ id: 'all', label: 'All', count: seenIds.size });

  // "Starred" tab — always present (matches sidebar which always shows Starred)
  if (allEnvelopes) {
    const starredCount = allEnvelopes.filter(e => e.starred).length;
    tabs.push({ id: 'starred', label: 'Starred', count: starredCount });
  }

  // "Recent" tab
  if (allEnvelopes && allEnvelopes.length > 0) {
    const recentCount = Math.min(RECENT_MAX_COUNT, allEnvelopes.length);
    tabs.push({ id: 'recent', label: 'Recent', count: recentCount });
  }

  // "Unread" tab — cross-folder aggregate of envelopes the user hasn't
  // looked at since last activity. Backed by the same `unseen` field
  // EnvelopeCard/EnvelopeItem use to render their blue dot. Archived
  // envelopes are excluded — "Unread" should only reflect active work.
  if (allEnvelopes) {
    const unreadCount = allEnvelopes.filter(e => (e as any).unseen === true && !e.archived_at).length;
    tabs.push({ id: 'unread', label: 'Unread', count: unreadCount });
  }

  // Tag tabs — sorted alphabetically by name
  const sortedFolders = Array.from(groupedEnvelopes.tagFolders.entries())
    .sort(([, a], [, b]) => a.tag.name.localeCompare(b.tag.name));
  for (const [tagId, folder] of sortedFolders) {
    if (folder.envelopes.length > 0) {
      tabs.push({
        id: tagId,
        label: folder.tag.name,
        count: folder.envelopes.length,
        color: folder.tag.color
      });
    }
  }

  // "Untagged" tab — only shown if count > 0
  const untaggedCount = groupedEnvelopes.specialFolders.untagged.length;
  if (untaggedCount > 0) {
    tabs.push({ id: 'untagged', label: 'Untagged', count: untaggedCount });
  }

  return tabs;
}

/**
 * Collects all unique envelopes from grouped structure into a flat array.
 */
function collectAllFromGroups(groupedEnvelopes: GroupedEnvelopes): IEnvelope[] {
  const seen = new Set<string>();
  const all: IEnvelope[] = [];

  groupedEnvelopes.tagFolders.forEach(folder => {
    folder.envelopes.forEach(e => {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        all.push(e);
      }
    });
  });
  groupedEnvelopes.specialFolders.untagged.forEach(e => {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      all.push(e);
    }
  });
  return all;
}

/**
 * Filters envelopes by the active tab selection.
 * When activeTab is a tag ID, includes envelopes from that tag and all its descendants.
 * Pass tags to enable descendant-aware filtering.
 */
export function filterEnvelopesByTab(
  groupedEnvelopes: GroupedEnvelopes,
  activeTab: string,
  tags?: ITag[]
): IEnvelope[] {
  if (activeTab === 'all') {
    return collectAllFromGroups(groupedEnvelopes);
  }

  if (activeTab === 'starred') {
    return collectAllFromGroups(groupedEnvelopes).filter(e => e.starred);
  }

  if (activeTab === 'recent') {
    return collectAllFromGroups(groupedEnvelopes)
      .sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, RECENT_MAX_COUNT);
  }

  if (activeTab === 'unread') {
    // Cross-folder aggregate of unseen non-archived envelopes — lets
    // the user see "what needs my attention" without hopping between
    // Inbox / Reviewing folders individually.
    return collectAllFromGroups(groupedEnvelopes).filter(
      (e) => (e as any).unseen === true && !e.archived_at
    );
  }

  if (activeTab === 'untagged') {
    return groupedEnvelopes.specialFolders.untagged;
  }

  // Specific tag ID — include descendants
  if (tags && tags.length > 0) {
    const ids = getSelfAndDescendantIds(tags, activeTab);
    const seen = new Set<string>();
    const result: IEnvelope[] = [];
    for (const id of ids) {
      const folder = groupedEnvelopes.tagFolders.get(id);
      if (folder) {
        for (const e of folder.envelopes) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            result.push(e);
          }
        }
      }
    }
    return result;
  }

  // Fallback: direct lookup (no tags provided)
  const folder = groupedEnvelopes.tagFolders.get(activeTab);
  return folder ? folder.envelopes : [];
}

/**
 * Searches within grouped envelopes (includes tag name matching)
 */
export function searchGroupedEnvelopes(
  groupedEnvelopes: GroupedEnvelopes,
  searchQuery: string
): GroupedEnvelopes {
  if (!searchQuery.trim()) {
    return groupedEnvelopes;
  }

  const query = searchQuery.toLowerCase();
  const filterEnvelopes = (envelopes: IEnvelope[]) =>
    envelopes.filter(envelope => {
      const title = (envelope.title || '').toLowerCase();
      const checklistName = ((envelope as any).last_report?.checklist_name || '').toLowerCase();
      const tagNames = (envelope.tags || []).map(t => t.name.toLowerCase()).join(' ');
      return title.includes(query) || checklistName.includes(query) || tagNames.includes(query);
    });

  const filteredTagFolders = new Map<string, { tag: ITag; envelopes: IEnvelope[] }>();
  groupedEnvelopes.tagFolders.forEach((folder, tagId) => {
    const filteredEnvelopes = filterEnvelopes(folder.envelopes);
    if (filteredEnvelopes.length > 0) {
      filteredTagFolders.set(tagId, {
        ...folder,
        envelopes: filteredEnvelopes
      });
    }
  });

  return {
    tagFolders: filteredTagFolders,
    specialFolders: {
      untagged: filterEnvelopes(groupedEnvelopes.specialFolders.untagged)
    }
  };
}
