import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import UserScriptEditor from '@/components/envelope-page/UserScriptEditor';

interface CustomScriptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (code: string, templateId?: string, templateName?: string) => void;
  initialCode?: string;
}

export default function CustomScriptDialog({
  isOpen,
  onClose,
  onSave,
  initialCode,
}: CustomScriptDialogProps) {
  const [code, setCode] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedName, setSelectedName] = useState<string | undefined>();

  useEffect(() => {
    if (isOpen) {
      setCode(initialCode || '');
      setSelectedId(undefined);
      setSelectedName(undefined);
    }
  }, [isOpen, initialCode]);

  const handleSave = () => {
    onSave(code.trim(), selectedId, selectedName);
    onClose();
  };

  const handleClear = () => {
    if (!window.confirm('Remove this script? This cannot be undone.')) return;
    onSave('', undefined, undefined);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Edit Envelope Script</DialogTitle>
          <DialogDescription>
            Define script_template variable for the output template, then compute data from checks.
          </DialogDescription>
        </DialogHeader>

        <UserScriptEditor
          code={code}
          onCodeChange={setCode}
          onTemplateSelect={(id, name) => { setSelectedId(id); setSelectedName(name); }}
        />

        <DialogFooter className="gap-2">
          {initialCode?.trim() && (
            <Button variant="destructive" size="sm" onClick={handleClear}>
              Remove Script
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
