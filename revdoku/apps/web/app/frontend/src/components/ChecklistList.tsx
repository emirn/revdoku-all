

import React, { useState, useMemo } from 'react';
import { IChecklist } from '@revdoku/lib';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, ClipboardCheck, Download, Eye, Copy, Trash2, MoreHorizontal, GitCompare, Search, Paperclip } from 'lucide-react';
import { hasRuleFileMarker } from '@/lib/rule-file-markers';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { ChecklistSortBy } from '@/hooks/useChecklistManager';
import OnboardingHint from '@/components/OnboardingHint';
import { formatCreatedUpdated, timeAgo } from '@/lib/date-utils';

interface ChecklistListProps {
  checklists: IChecklist[];
  isLoading: boolean;
  error: string | null;
  onViewChecklist: (checklist: IChecklist) => void;
  onAddChecklist: () => void;
  onDeleteChecklist: (id: string) => Promise<void>;
  onDuplicateChecklist?: (checklist: IChecklist) => Promise<IChecklist>;
  sortBy?: ChecklistSortBy;
  onSortChange?: (sort: ChecklistSortBy) => void;
  showOnboardingHints?: boolean;
}

export function ChecklistList({
  checklists,
  isLoading,
  error,
  onViewChecklist,
  onAddChecklist,
  onDeleteChecklist,
  onDuplicateChecklist,
  sortBy = 'name',
  onSortChange,
  showOnboardingHints
}: ChecklistListProps) {

  const [searchQuery, setSearchQuery] = useState('');

  const filteredChecklists = useMemo(() => {
    if (!searchQuery.trim()) return checklists;
    const q = searchQuery.toLowerCase();
    return checklists.filter((c) =>
      (c.name ?? '').toLowerCase().includes(q) ||
      ((c as any).system_prompt ?? '').toLowerCase().includes(q)
    );
  }, [checklists, searchQuery]);

  function downloadChecklistAsJson(checklist: IChecklist) {
    const fileName = `${(checklist.name ?? 'checklist').replace(/\s+/g, '_').toLowerCase()}_${checklist.id}.json`;
    const json = JSON.stringify(checklist, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-60">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading checklists...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/50 border-l-4 border-red-500 p-4">
        <div className="flex">
          <div className="ml-3">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (checklists.length === 0) {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
          <ClipboardCheck className="h-8 w-8 text-indigo-500" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">No checklists yet</h3>
        <p className="text-muted-foreground mb-6">Create your first checklist to start reviewing documents</p>
        <Button onClick={onAddChecklist} size="lg">
          <PlusCircle className="h-5 w-5 mr-2" />
          Add Checklist
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Checklists</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search checklists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-[200px] pl-8 text-sm"
            />
          </div>
          <Select value={sortBy} onValueChange={(value) => onSortChange?.(value as ChecklistSortBy)}>
            <SelectTrigger className="w-[170px] h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort by Name</SelectItem>
              <SelectItem value="updated">Sort by Updated</SelectItem>
              <SelectItem value="created">Sort by Created</SelectItem>
            </SelectContent>
          </Select>
          {showOnboardingHints ? (
            <OnboardingHint
              hintKey="guide-new-checklist-page"
              message="Create your first checklist"
              position="bottom"
            >
              <Button onClick={onAddChecklist}>
                <PlusCircle className="h-4 w-4 mr-2" />
                Add Checklist
              </Button>
            </OnboardingHint>
          ) : (
            <Button onClick={onAddChecklist}>
              <PlusCircle className="h-4 w-4 mr-2" />
              Add Checklist
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {filteredChecklists.map((checklist) => (
          <div
            key={checklist.id}
            className="flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition-all cursor-pointer"
            onClick={() => onViewChecklist(checklist)}
          >
            <div className="flex items-center flex-1 min-w-0">
              <ClipboardCheck className="h-5 w-5 text-indigo-500 flex-shrink-0 mr-3" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-medium text-foreground truncate">{checklist.name}</h4>
                  {(checklist as any).revision_number && (
                    <Badge variant="outline" className="text-xs">v{(checklist as any).revision_number}</Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {checklist.rules.length} {checklist.rules.length === 1 ? 'rule' : 'rules'}
                  </Badge>
                  {(() => {
                    // Prefer the backend-computed count (avoids re-scanning on
                    // every render); fall back to client-side scan when the
                    // payload predates the field or it's missing.
                    let refCount: number = (checklist as any).ref_files_required ?? 0;
                    if (!refCount) {
                      if (hasRuleFileMarker((checklist as any).system_prompt)) refCount += 1;
                      refCount += checklist.rules.filter(r => hasRuleFileMarker(r.prompt)).length;
                    }
                    if (!refCount) return null;
                    return (
                      <Badge variant="outline" className="text-xs flex items-center gap-1 border-indigo-200 text-indigo-700 dark:border-indigo-900 dark:text-indigo-300" title="Requires reference files">
                        <Paperclip className="h-3 w-3" />
                        {refCount} ref {refCount === 1 ? 'file' : 'files'}
                      </Badge>
                    );
                  })()}
                  {checklist.updated_at && (
                    <span className="text-xs text-muted-foreground/50 ml-1">{timeAgo(checklist.updated_at)}</span>
                  )}
                </div>
                {(checklist as any).system_prompt && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {(checklist as any).system_prompt}
                  </p>
                )}
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {formatCreatedUpdated((checklist as any).created_at, checklist.updated_at)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 ml-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewChecklist(checklist)}
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => downloadChecklistAsJson(checklist)}>
                    <Download className="h-4 w-4 mr-2" />
                    Download JSON
                  </DropdownMenuItem>
                  {onDuplicateChecklist && (
                    <DropdownMenuItem onClick={() => onDuplicateChecklist(checklist)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete this checklist?')) {
                        onDeleteChecklist(checklist.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
