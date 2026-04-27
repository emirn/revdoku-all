import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ITag, TagColor } from '@revdoku/lib';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import TagDot from './TagDot';

interface NewLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: ITag[];
  onCreateTag: (name: string, color: TagColor, parentId: string | null) => void;
}

export default function NewLabelDialog({
  open,
  onOpenChange,
  tags,
  onCreateTag,
}: NewLabelDialogProps) {
  const [name, setName] = useState('');
  const [nestUnder, setNestUnder] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setNestUnder(false);
      setParentId(null);
    }
  }, [open]);

  const parentOptions = useMemo(() => {
    return [...tags].sort((a, b) => {
      const ap = a.full_path || a.name;
      const bp = b.full_path || b.name;
      return ap.localeCompare(bp);
    });
  }, [tags]);

  const canCreate = name.trim().length > 0 && (!nestUnder || !!parentId);
  const hasTags = parentOptions.length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreateTag(name.trim(), 'blue', nestUnder && parentId ? parentId : null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New label</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-label-name" className="text-sm text-foreground">
              Please enter a new label name:
            </label>
            <Input
              id="new-label-name"
              ref={inputRef}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={nestUnder}
                onChange={(e) => {
                  setNestUnder(e.target.checked);
                  if (!e.target.checked) setParentId(null);
                }}
                disabled={!hasTags}
                className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              />
              Nest label under:
            </label>

            <Select
              value={parentId ?? ''}
              onValueChange={(v) => setParentId(v || null)}
              disabled={!nestUnder || !hasTags}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={hasTags ? 'Select a parent label…' : 'No labels to nest under'} />
              </SelectTrigger>
              <SelectContent>
                {parentOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="inline-flex items-center gap-2">
                      <TagDot color={t.color} size="sm" />
                      <span>{t.full_path || t.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
