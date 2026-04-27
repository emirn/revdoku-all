import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileX, FileQuestion } from 'lucide-react';
import { IEnvelope } from '@revdoku/lib';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import VirtualizedEnvelopeList from './VirtualizedEnvelopeList';

interface SpecialFolderProps {
  type: 'no-checklist' | 'multiple-checklists';
  envelopes: IEnvelope[];
  isExpanded: boolean;
  onToggle: () => void;
  onDeleteEnvelope?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  highlightedEnvelopeId?: string | null;
}

const getFolderConfig = (type: SpecialFolderProps['type']) => {
  switch (type) {
    case 'no-checklist':
      return {
        name: 'No Checklist',
        description: 'Envelopes without a checklist assigned',
        icon: FileX,
        iconColor: 'text-muted-foreground',
        hoverBgColor: 'hover:bg-accent'
      };
    case 'multiple-checklists':
      return {
        name: 'Multiple Checklists',
        description: 'Envelopes with varying checklists across revisions',
        icon: FileQuestion,
        iconColor: 'text-orange-500 dark:text-orange-400',
        hoverBgColor: 'hover:bg-orange-50 dark:hover:bg-orange-950/30'
      };
    default:
      return {
        name: 'Unknown',
        description: '',
        icon: FileX,
        iconColor: 'text-muted-foreground',
        hoverBgColor: 'hover:bg-accent'
      };
  }
};

const SpecialFolder = React.memo(function SpecialFolder({
  type,
  envelopes,
  isExpanded,
  onToggle,
  onDeleteEnvelope,
  onToggleStar,
  onArchive,
  onDuplicate,
  selectedIds,
  onToggleSelection,
  highlightedEnvelopeId
}: SpecialFolderProps) {
  const [displayCount, setDisplayCount] = useState(50);
  const config = getFolderConfig(type);
  const Icon = config.icon;


  if (envelopes.length === 0) {
    return null;
  }

  return (
    <Card className="mb-2">
      {/* Folder Header */}
      <div
        className={`flex items-center p-3 cursor-pointer ${config.hoverBgColor} transition-colors`}
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
            <Icon className={`h-5 w-5 ${config.iconColor}`} />
          </div>

          {/* Folder Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-3">
              <h3 className="font-medium text-foreground truncate">
                {config.name}
              </h3>
              <Badge variant="secondary">
                {envelopes.length} {envelopes.length === 1 ? 'envelope' : 'envelopes'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {config.description}
            </p>
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

export default SpecialFolder;