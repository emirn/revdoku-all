import { useState } from 'react';
import { Copy, History, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CopyMode = 'latest_only' | 'all_revisions';

interface DuplicateEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (copyMode: CopyMode, includeManualChecks: boolean) => void;
  isLoading?: boolean;
}

const options: { value: CopyMode; label: string; description: string; icon: typeof Copy }[] = [
  {
    value: 'all_revisions',
    label: 'All revisions',
    description: 'Copy full history including all document revisions',
    icon: History,
  },
  {
    value: 'latest_only',
    label: 'Latest only',
    description: 'Copy only the latest revision for a clean slate',
    icon: Copy,
  },
];

export function DuplicateEnvelopeDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: DuplicateEnvelopeDialogProps) {
  const [selected, setSelected] = useState<CopyMode>('all_revisions');
  const [includeManualChecks, setIncludeManualChecks] = useState(true);

  return (
    <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate Envelope</DialogTitle>
          <DialogDescription>
            Choose which revisions to include in the copy.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          {options.map((option) => {
            const Icon = option.icon;
            const isSelected = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={isLoading}
                onClick={() => setSelected(option.value)}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/30'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    isSelected
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40'
                  )}
                >
                  {isSelected && (
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{option.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            id="include-manual-checks"
            checked={includeManualChecks}
            onChange={(e) => setIncludeManualChecks(e.target.checked)}
            disabled={isLoading}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="include-manual-checks" className="flex-1 space-y-0.5 cursor-pointer">
            <span className="text-sm font-medium block">Include envelope checks and rules</span>
            <span className="text-xs text-muted-foreground block">
              Copy envelope rules and their check annotations
            </span>
          </label>
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs text-muted-foreground">Cost: 1 credit</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button onClick={() => onConfirm(selected, includeManualChecks)} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Duplicate
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
