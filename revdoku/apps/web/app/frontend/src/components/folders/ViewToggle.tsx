import React from 'react';
import { FolderTree, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ViewToggleProps {
  viewMode: 'folders' | 'list';
  onViewModeChange: (mode: 'folders' | 'list') => void;
}

const ViewToggle = React.memo(function ViewToggle({ viewMode, onViewModeChange }: ViewToggleProps) {
  return (
    <div className="flex items-center space-x-1 bg-muted rounded-lg p-1">
      <Button
        onClick={() => onViewModeChange('folders')}
        variant={viewMode === 'folders' ? 'default' : 'ghost'}
        size="sm"
        className="flex items-center space-x-2"
      >
        <FolderTree className="h-4 w-4" />
        <span>Auto-groups</span>
      </Button>
      <Button
        onClick={() => onViewModeChange('list')}
        variant={viewMode === 'list' ? 'default' : 'ghost'}
        size="sm"
        className="flex items-center space-x-2"
      >
        <List className="h-4 w-4" />
        <span>List</span>
      </Button>
    </div>
  );
});

export default ViewToggle;