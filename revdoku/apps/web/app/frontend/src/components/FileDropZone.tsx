import React, { useState, useRef } from 'react';
import { Upload } from 'lucide-react';

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  /** Size variant: 'default' for inline use, 'large' for full-page empty states */
  size?: 'default' | 'large';
}

export default function FileDropZone({
  onFilesSelected,
  accept = '.pdf,.jpg,.jpeg,.png,.webp,.gif',
  multiple = true,
  disabled = false,
  className = '',
  size = 'default',
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFilesSelected(files);
  };

  const handleClick = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onFilesSelected(files);
    e.target.value = '';
  };

  return (
    <>
      <div
        className={`inline-flex items-center justify-center gap-2 border-2 border-dashed rounded-md cursor-pointer transition-colors px-4 py-2 text-sm font-medium ${
          disabled
            ? 'opacity-50 cursor-not-allowed border-border bg-muted text-muted-foreground'
            : isDragOver
              ? 'border-indigo-300 bg-indigo-700 text-white'
              : 'border-indigo-400 bg-indigo-600 hover:bg-indigo-700 text-white'
        } ${className}`}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload className="h-4 w-4" />
        <span>{isDragOver ? 'Drop files here' : 'Drop files or click to open'}</span>
        <span className="text-xs opacity-70 ml-1">PDF, JPG, PNG</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={handleFileChange}
        disabled={disabled}
      />
    </>
  );
}
