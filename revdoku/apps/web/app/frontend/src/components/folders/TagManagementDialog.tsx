import React, { useState, useMemo } from 'react';
import type { ITag, TagColor } from '@revdoku/lib';
import { Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TagDot from './TagDot';
import { TAG_DOT_CLASSES } from '@/lib/tag-colors';
import { buildTagTree, getSelfAndDescendantIds, type TagTreeNode } from '@/lib/tag-tree';

const ALL_COLORS: TagColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

interface TagManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: ITag[];
  onCreateTag: (name: string, color: TagColor, parentId?: string | null) => void;
  onUpdateTag: (id: string, data: { name?: string; color?: TagColor; parent_id?: string | null }) => void;
  onDeleteTag: (id: string) => void;
}

/** Renders a "Nest under" <select> dropdown, disabling descendants to prevent cycles. */
function ParentSelector({
  tags,
  currentTagId,
  value,
  onChange,
}: {
  tags: ITag[];
  currentTagId?: string;
  value: string | null | undefined;
  onChange: (parentId: string | null) => void;
}) {
  // Compute which IDs are descendants of the current tag (to disable as parent options)
  const disabledIds = useMemo(() => {
    if (!currentTagId) return new Set<string>();
    return getSelfAndDescendantIds(tags, currentTagId);
  }, [tags, currentTagId]);

  const tree = useMemo(() => buildTagTree(tags), [tags]);

  // Flatten tree for rendering with indentation
  const options: { id: string; label: string; depth: number; disabled: boolean }[] = [];
  function walk(nodes: TagTreeNode[]) {
    for (const node of nodes) {
      options.push({
        id: node.tag.id,
        label: node.tag.name,
        depth: node.depth,
        disabled: disabledIds.has(node.tag.id),
      });
      walk(node.children);
    }
  }
  walk(tree);

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-7 text-xs border rounded px-1.5 bg-background text-foreground min-w-[100px] max-w-[160px]"
      title="Nest under"
    >
      <option value="">(Root)</option>
      {options.map(opt => (
        <option key={opt.id} value={opt.id} disabled={opt.disabled}>
          {'  '.repeat(opt.depth)}{opt.label}
        </option>
      ))}
    </select>
  );
}

export default function TagManagementDialog({
  open,
  onOpenChange,
  tags,
  onCreateTag,
  onUpdateTag,
  onDeleteTag
}: TagManagementDialogProps) {
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<TagColor>('blue');
  const [newTagParentId, setNewTagParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [colorPickerTagId, setColorPickerTagId] = useState<string | null>(null);

  const tagTree = useMemo(() => buildTagTree(tags), [tags]);

  const handleCreate = () => {
    const name = newTagName.trim();
    if (!name) return;
    onCreateTag(name, newTagColor, newTagParentId);
    setNewTagName('');
    setNewTagParentId(null);
  };

  const handleStartEdit = (tag: ITag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  const handleFinishEdit = (tagId: string) => {
    const name = editName.trim();
    if (name) {
      onUpdateTag(tagId, { name });
    }
    setEditingId(null);
  };

  const handleColorChange = (tagId: string, color: TagColor) => {
    onUpdateTag(tagId, { color });
    setColorPickerTagId(null);
  };

  const handleParentChange = (tagId: string, parentId: string | null) => {
    onUpdateTag(tagId, { parent_id: parentId });
  };

  const handleDelete = (tag: ITag) => {
    const allDescendantIds = getSelfAndDescendantIds(tags, tag.id);
    const descendants = tags.filter(t => allDescendantIds.has(t.id) && t.id !== tag.id);

    let msg: string;
    if (descendants.length > 0) {
      const names = descendants.map(d => d.name).join(', ');
      msg = `Delete "${tag.name}" and its ${descendants.length} nested label${descendants.length > 1 ? 's' : ''} (${names})?\nThis will also remove them from all envelopes.`;
    } else {
      msg = `Delete tag "${tag.name}"? It will be removed from all envelopes.`;
    }

    if (window.confirm(msg)) {
      onDeleteTag(tag.id);
    }
  };

  // Render tag rows as indented tree
  const renderTagRow = (node: TagTreeNode) => {
    const tag = node.tag;
    return (
      <React.Fragment key={tag.id}>
        <div
          className="flex items-center gap-2.5 group rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: 8 + node.depth * 20 }}
        >
          {/* Color dot (click to change) */}
          <div className="relative shrink-0">
            <button
              onClick={() => setColorPickerTagId(colorPickerTagId === tag.id ? null : tag.id)}
              className="hover:scale-125 transition-transform"
              title="Change color"
            >
              <TagDot color={tag.color} size="md" />
            </button>
            {colorPickerTagId === tag.id && (
              <div className="absolute left-0 top-5 z-10 flex items-center gap-1.5 bg-popover border rounded-md p-1.5 shadow-md">
                {ALL_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => handleColorChange(tag.id, c)}
                    className={`w-4 h-4 rounded-full ${TAG_DOT_CLASSES[c]} hover:scale-125 transition-transform ${
                      c === tag.color ? 'ring-2 ring-offset-1 ring-foreground/40' : ''
                    }`}
                    title={c}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Name (editable on click) */}
          {editingId === tag.id ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleFinishEdit(tag.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishEdit(tag.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              className="h-7 text-sm flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <span
              onClick={() => handleStartEdit(tag)}
              className="text-sm text-foreground hover:text-indigo-600 cursor-pointer flex-1 min-w-0 truncate"
              title={tag.full_path || tag.name}
            >
              {tag.name}
            </span>
          )}

          {/* Nest under selector */}
          <ParentSelector
            tags={tags}
            currentTagId={tag.id}
            value={tag.parent_id}
            onChange={(parentId) => handleParentChange(tag.id, parentId)}
          />

          {/* Auto-source indicator */}
          {tag.auto_source && (
            <span className="text-[10px] text-muted-foreground/50 shrink-0 italic">auto</span>
          )}

          {/* Delete */}
          <button
            onClick={() => handleDelete(tag)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
            title="Delete tag"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {node.children.map(child => renderTagRow(child))}
      </React.Fragment>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {tagTree.map(rootNode => renderTagRow(rootNode))}
        </div>

        {/* Add new tag */}
        <div className="flex items-center gap-2.5 pt-3 border-t">
          <div className="shrink-0">
            <button
              onClick={() => {
                const idx = ALL_COLORS.indexOf(newTagColor);
                setNewTagColor(ALL_COLORS[(idx + 1) % ALL_COLORS.length]);
              }}
              className="hover:scale-125 transition-transform"
              title="Click to cycle color"
            >
              <TagDot color={newTagColor} size="md" />
            </button>
          </div>
          <Input
            placeholder="New tag name..."
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            className="h-8 text-sm flex-1 min-w-0"
          />
          <ParentSelector
            tags={tags}
            value={newTagParentId}
            onChange={setNewTagParentId}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCreate}
            disabled={!newTagName.trim()}
            className="h-8 px-2.5 shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
