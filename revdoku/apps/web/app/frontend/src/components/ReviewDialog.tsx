import { useState } from 'react';
import { Loader2, Info } from 'lucide-react';
import type { IReport, ICheck } from '@revdoku/lib';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (usePreviousChecks: boolean) => void;
  previousReport: IReport;
  isLoading?: boolean;
}

export function ReviewDialog({
  open,
  onOpenChange,
  onConfirm,
  previousReport,
  isLoading = false,
}: ReviewDialogProps) {
  const [usePreviousChecks, setUsePreviousChecks] = useState(true);

  const checks = previousReport.checks || [];
  const failedCount = checks.filter((c: ICheck) => !c.passed).length;
  const passedCount = checks.filter((c: ICheck) => c.passed).length;

  return (
    <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review Settings</DialogTitle>
          <DialogDescription>
            Configure how this revision will be reviewed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              id="use-previous-checks"
              checked={usePreviousChecks}
              onChange={(e) => setUsePreviousChecks(e.target.checked)}
              disabled={isLoading}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="use-previous-checks" className="flex-1 space-y-1 cursor-pointer">
              <span className="text-sm font-medium block">Use checks from previous revision</span>
              {usePreviousChecks ? (
                <span className="text-xs text-muted-foreground block">
                  {failedCount} failed and {passedCount} passed check{passedCount !== 1 ? 's' : ''} from the previous revision will be used as context for this review.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground block">
                  Previous revision checks will not be sent to the AI. The review will start fresh.
                </span>
              )}
              {usePreviousChecks && (
                <span className="text-xs text-muted-foreground/80 block">
                  The AI will re-verify previously failed locations and check that passed locations haven't regressed.
                </span>
              )}
            </label>
          </div>

          <div className="flex items-start gap-2 px-1">
            <Info className="h-3.5 w-3.5 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-muted-foreground/80">
              Envelope checks and rules are always preserved across revisions.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={() => onConfirm(usePreviousChecks)} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
