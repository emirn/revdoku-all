import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IEnvelope, ITag, TagColor } from '@revdoku/lib';
import { ApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { showToast } from '@/lib/toast';
import { AuthCheck } from '@/components/auth-check';
import EnvelopeFolderView from '@/components/folders/EnvelopeFolderView';
import { DuplicateEnvelopeDialog } from '@/components/DuplicateEnvelopeDialog';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useEnvelopesLayout } from './EnvelopesLayout';

export default function EnvelopeListPage() {
  const layout = useEnvelopesLayout();
  const { envelopes, archivedEnvelopes, tags, isLoading, folderView, refreshEnvelopes, onToggleTag, createEnvelope, createEnvelopeWithFiles } = layout;

  const [duplicateTargetId, setDuplicateTargetId] = useState<string | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [highlightedEnvelopeId, setHighlightedEnvelopeId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Auto-clear highlight after animation completes
  useEffect(() => {
    if (!highlightedEnvelopeId) return;
    const timer = setTimeout(() => setHighlightedEnvelopeId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedEnvelopeId]);

  const deleteEnvelope = async (id: string) => {
    try {
      await ApiClient.deleteEnvelope(id);
      refreshEnvelopes();
    } catch (error) {
      console.error('Failed to delete envelope:', error);
    }
  };

  const toggleStar = async (id: string) => {
    try {
      await ApiClient.toggleEnvelopeStar(id);
      refreshEnvelopes();
    } catch (error) {
      console.error('Failed to toggle star:', error);
    }
  };

  const archiveEnvelope = async (id: string) => {
    try {
      await ApiClient.archiveEnvelope(id);
      refreshEnvelopes();
    } catch (error) {
      console.error('Failed to archive envelope:', error);
    }
  };

  const unarchiveEnvelope = async (id: string) => {
    try {
      await ApiClient.unarchiveEnvelope(id);
      refreshEnvelopes();
    } catch (error) {
      console.error('Failed to unarchive envelope:', error);
    }
  };

  const duplicateEnvelope = (id: string) => {
    setDuplicateTargetId(id);
  };

  const handleDuplicateConfirm = async (copyMode: 'latest_only' | 'all_revisions', includeManualChecks: boolean) => {
    if (!duplicateTargetId) return;
    try {
      setIsDuplicating(true);
      const result = await ApiClient.duplicateEnvelope(duplicateTargetId, copyMode, includeManualChecks);
      setHighlightedEnvelopeId(result.envelope.id);
      refreshEnvelopes();
    } catch (error) {
      console.error('Failed to duplicate envelope:', error);
      showToast(error instanceof ApiError ? error.message : 'Failed to duplicate envelope', 'error');
    } finally {
      setIsDuplicating(false);
      setDuplicateTargetId(null);
    }
  };

  const handleBulkAction = async (action: 'archive' | 'unarchive' | 'delete', ids: string[]) => {
    try {
      await ApiClient.bulkEnvelopeAction(action, ids);
      refreshEnvelopes();
    } catch (error) {
      console.error('Failed to perform bulk action:', error);
    }
  };

  return (
    <AuthCheck>
      <DuplicateEnvelopeDialog
        open={duplicateTargetId !== null}
        onOpenChange={(open) => { if (!open) setDuplicateTargetId(null); }}
        onConfirm={handleDuplicateConfirm}
        isLoading={isDuplicating}
      />
      <PullToRefresh onRefresh={refreshEnvelopes}>
        <EnvelopeFolderView
          envelopes={envelopes}
          archivedEnvelopes={archivedEnvelopes}
          tags={tags}
          isLoading={isLoading}
          folderView={folderView}
          onDeleteEnvelope={deleteEnvelope}
          onToggleStar={toggleStar}
          onArchive={archiveEnvelope}
          onUnarchive={unarchiveEnvelope}
          onDuplicate={duplicateEnvelope}
          onBulkAction={handleBulkAction}
          highlightedEnvelopeId={highlightedEnvelopeId}
          onToggleTag={onToggleTag}
          onCreateEnvelope={createEnvelope}
          onCreateEnvelopeWithFiles={createEnvelopeWithFiles}
        />
      </PullToRefresh>
    </AuthCheck>
  );
}
