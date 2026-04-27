import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, ClipboardCheck } from 'lucide-react';
import { IEnvelope, IChecklist } from '@revdoku/lib';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import VirtualizedEnvelopeList from './VirtualizedEnvelopeList';
import { getCompliancePercentColor } from '@/lib/envelope-status';

interface ChecklistFolderProps {
  checklist: IChecklist;
  envelopes: IEnvelope[];
  isExpanded: boolean;
  onToggle: () => void;
  showProgress?: boolean;
  onDeleteEnvelope?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  highlightedEnvelopeId?: string | null;
}

const ChecklistFolder = React.memo(function ChecklistFolder({
  checklist,
  envelopes,
  isExpanded,
  onToggle,
  showProgress = true,
  onDeleteEnvelope,
  onToggleStar,
  onArchive,
  onDuplicate,
  selectedIds,
  onToggleSelection,
  highlightedEnvelopeId
}: ChecklistFolderProps) {
  const [displayCount, setDisplayCount] = useState(50);
  const folderStats = useMemo(() => {
    let totalChecks = 0;
    let passedChecks = 0;

    envelopes.forEach(envelope => {
      const report = (envelope as any).last_report;
      if (report) {
        totalChecks += report.total_checks ?? 0;
        passedChecks += report.passed_checks ?? 0;
      }
    });

    const progress = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
    return { progress, totalChecks, passedChecks };
  }, [envelopes]);


  return (
    <Card className="mb-2">
      {/* Folder Header */}
      <div
        className="flex items-center p-3 cursor-pointer hover:bg-accent transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center flex-1">
          {/* Expand/Collapse Icon */}
          <div className="mr-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          
          {/* Folder Icon */}
          <div className="mr-3">
            {isExpanded ? (
              <FolderOpen className="h-5 w-5 text-blue-600" />
            ) : (
              <Folder className="h-5 w-5 text-blue-600" />
            )}
          </div>
          
          {/* Folder Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-3">
              <h3 className="font-medium text-foreground truncate">
                {checklist.name}
              </h3>
              <ClipboardCheck className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
              <Badge variant="secondary">
                {envelopes.length} {envelopes.length === 1 ? 'envelope' : 'envelopes'}
              </Badge>
            </div>
            {checklist.system_prompt && (
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {checklist.system_prompt}
              </p>
            )}
            {/* Compliance progress */}
            {showProgress && folderStats.totalChecks > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-sm font-bold tabular-nums ${getCompliancePercentColor(folderStats.progress)}`}>
                  {folderStats.progress}%
                </span>
                <div className="h-1.5 w-[120px] rounded-full overflow-hidden flex">
                  <div className="h-full bg-green-500" style={{ width: `${folderStats.progress}%` }} />
                  <div className="h-full bg-red-400" style={{ width: `${100 - folderStats.progress}%` }} />
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {folderStats.passedChecks}/{folderStats.totalChecks}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Folder Contents */}
      {isExpanded && (
        <CardContent className="border-t pt-2 pb-2">
          <VirtualizedEnvelopeList
            envelopes={envelopes}
            maxDisplayCount={displayCount}
            showLoadMore={envelopes.length > displayCount}
            onLoadMore={() => setDisplayCount(prev => prev + 50)}
            onDelete={onDeleteEnvelope}
            onToggleStar={onToggleStar}
            onArchive={onArchive}
            onDuplicate={onDuplicate}
            selectedIds={selectedIds}
            onToggleSelection={onToggleSelection}
            highlightedEnvelopeId={highlightedEnvelopeId}
          />
        </CardContent>
      )}
    </Card>
  );
});

export default ChecklistFolder;