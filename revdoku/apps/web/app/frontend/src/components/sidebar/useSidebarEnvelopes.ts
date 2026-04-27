import { useState, useEffect, useCallback, useMemo } from 'react';
import { ApiClient } from '@/lib/api-client';
import { getEnvelopeComplianceStatus } from '@/lib/envelope-grouping';
import { getInspectionStatus, type InspectionStatus } from '@/lib/envelope-status';
import type { IEnvelope } from '@revdoku/lib';

export interface SidebarSection {
  key: 'drafts' | 'reviewing';
  label: string;
  envelopes: SidebarEnvelopeInfo[];
}

export interface SidebarEnvelopeInfo {
  id: string;
  prefixId: string;
  title: string;
  inspection: InspectionStatus;
}

function toSidebarInfo(envelope: IEnvelope): SidebarEnvelopeInfo {
  return {
    id: envelope.id,
    prefixId: envelope.id,
    title: envelope.title || 'Untitled',
    inspection: getInspectionStatus(envelope),
  };
}

export function useSidebarEnvelopes() {
  const [envelopes, setEnvelopes] = useState<IEnvelope[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Issue #6: This intentionally makes its own API call. The sidebar and list page
  // don't share state, so each fetches independently. Could be optimized with a
  // shared cache layer in the future.
  //
  // Issue #7: isLoading is only true on initial load. Subsequent refreshes (via
  // sidebar:refresh event) update the list silently to avoid flashing the spinner.
  const fetchEnvelopes = useCallback(async () => {
    try {
      setError(null);
      const res = await ApiClient.getEnvelopes();
      setEnvelopes(res.envelopes);
    } catch (err) {
      console.error('Sidebar: failed to fetch envelopes', err);
      // Issue #8: Surface error state to UI
      setError('Failed to load envelopes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnvelopes();
  }, [fetchEnvelopes]);

  // Listen for sidebar:refresh custom event
  useEffect(() => {
    const handler = () => fetchEnvelopes();
    document.addEventListener('sidebar:refresh', handler);
    return () => document.removeEventListener('sidebar:refresh', handler);
  }, [fetchEnvelopes]);

  const sections = useMemo<SidebarSection[]>(() => {
    const query = searchQuery.toLowerCase().trim();

    const filtered = query
      ? envelopes.filter(e => (e.title || '').toLowerCase().includes(query))
      : envelopes;

    const groups: Record<'drafts' | 'reviewing', SidebarEnvelopeInfo[]> = {
      'drafts': [],
      'reviewing': [],
    };

    for (const env of filtered) {
      const status = getEnvelopeComplianceStatus(env);
      groups[status].push(toSidebarInfo(env));
    }

    return [
      { key: 'drafts', label: 'Drafts', envelopes: groups['drafts'] },
      { key: 'reviewing', label: 'Reviewing', envelopes: groups['reviewing'] },
    ];
  }, [envelopes, searchQuery]);

  return {
    sections,
    isLoading,
    error,
    refetch: fetchEnvelopes,
    searchQuery,
    setSearchQuery,
  };
}
