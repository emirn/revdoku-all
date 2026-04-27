import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ITag } from '@revdoku/lib';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, ExternalLink, Trash2, Archive, ArchiveRestore, Code, ScrollText, Copy, Tag } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface EnvelopeActionsMenuProps {
  envelopeId: string;
  isArchiveView?: boolean;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  availableTags?: ITag[];
  onToggleTag?: (envelopeId: string, tagId: string) => void;
  tagPickerTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}

const EnvelopeActionsMenu = React.memo(function EnvelopeActionsMenu({
  envelopeId,
  isArchiveView,
  onDelete,
  onArchive,
  onUnarchive,
  onDuplicate,
  availableTags,
  onToggleTag,
  tagPickerTriggerRef,
}: EnvelopeActionsMenuProps) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => navigate(`/envelopes/view?id=${envelopeId}`)}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/account/audit?envelope_id=${envelopeId}`)}>
          <ScrollText className="h-4 w-4 mr-2" />
          View Audit Log
        </DropdownMenuItem>
        {availableTags && onToggleTag && (
          <DropdownMenuItem onClick={() => {
            setTimeout(() => tagPickerTriggerRef?.current?.click(), 50);
          }}>
            <Tag className="h-4 w-4 mr-2" />
            Tags
          </DropdownMenuItem>
        )}
        {onDuplicate && (
          <DropdownMenuItem onClick={() => onDuplicate(envelopeId)}>
            <Copy className="h-4 w-4 mr-2" />
            Duplicate
          </DropdownMenuItem>
        )}
        {!isArchiveView && onArchive && (
          <DropdownMenuItem onClick={() => onArchive(envelopeId)}>
            <Archive className="h-4 w-4 mr-2" />
            Archive
          </DropdownMenuItem>
        )}
        {isArchiveView && onUnarchive && (
          <DropdownMenuItem onClick={() => onUnarchive(envelopeId)}>
            <ArchiveRestore className="h-4 w-4 mr-2" />
            Unarchive
          </DropdownMenuItem>
        )}
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (window.confirm('Permanently delete this envelope? This action cannot be undone.')) {
                  onDelete(envelopeId);
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default EnvelopeActionsMenu;
