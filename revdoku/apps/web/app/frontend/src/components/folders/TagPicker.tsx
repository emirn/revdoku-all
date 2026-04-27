import React, { useMemo } from 'react';
import type { ITag } from '@revdoku/lib';
import { Check, Settings } from 'lucide-react';
import TagDot from './TagDot';
import { buildTagTree, type TagTreeNode } from '@/lib/tag-tree';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface TagPickerProps {
  availableTags: ITag[];
  assignedTagIds: Set<string>;
  onToggleTag: (tagId: string) => void;
  onManageTags?: () => void;
  children: React.ReactNode;
  /** Controlled open state — when provided, overrides internal state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const TagPicker = React.memo(function TagPicker({
  availableTags,
  assignedTagIds,
  onToggleTag,
  onManageTags,
  children,
  open: controlledOpen,
  onOpenChange
}: TagPickerProps) {
  const tagTree = useMemo(() => buildTagTree(availableTags), [availableTags]);

  // Flatten tree depth-first (all expanded) for picker display
  const flatItems: { tag: ITag; depth: number }[] = useMemo(() => {
    const result: { tag: ITag; depth: number }[] = [];
    function walk(nodes: TagTreeNode[]) {
      for (const node of nodes) {
        result.push({ tag: node.tag, depth: node.depth });
        walk(node.children);
      }
    }
    walk(tagTree);
    return result;
  }, [tagTree]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-96">
        {flatItems.map(({ tag, depth }) => {
          const isAssigned = assignedTagIds.has(tag.id);
          return (
            <DropdownMenuItem
              key={tag.id}
              onClick={() => onToggleTag(tag.id)}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              {depth > 0 && <span style={{ width: depth * 16 }} className="flex-shrink-0" />}
              <TagDot color={tag.color} size="md" />
              <span className="flex-1 truncate">{tag.name}</span>
              {isAssigned && (
                <Check className="h-3.5 w-3.5 text-indigo-600 flex-shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
        {onManageTags && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageTags} className="flex items-center gap-2.5 text-muted-foreground">
              <Settings className="h-3.5 w-3.5" />
              <span>Manage Tags...</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default TagPicker;
