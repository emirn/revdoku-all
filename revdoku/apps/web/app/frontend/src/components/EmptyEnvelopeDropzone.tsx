import React, { type ReactNode } from 'react';
import FileDropZone from '@/components/FileDropZone';
import { InboundEmailHint } from '@ee/components/InboundEmailHint';

interface EmptyEnvelopeDropzoneProps {
  /** Icon rendered above the headline. */
  icon?: ReactNode;
  headline: string;
  subtext?: string;
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  /** FileDropZone size — 'large' for full-page, 'default' for inline. */
  size?: 'default' | 'large';
  /** Wrap the dropzone (e.g. with an OnboardingHint) without touching the email hint. */
  dropzoneWrapper?: (dropzone: ReactNode) => ReactNode;
  /** Max width for the drop area + email hint column. */
  maxWidthClass?: string;
}

export default function EmptyEnvelopeDropzone({
  icon,
  headline,
  subtext,
  onFilesSelected,
  disabled = false,
  size = 'default',
  dropzoneWrapper,
  maxWidthClass = 'max-w-sm',
}: EmptyEnvelopeDropzoneProps) {
  const dropzone = (
    <FileDropZone
      onFilesSelected={onFilesSelected}
      disabled={disabled}
      size={size}
    />
  );

  return (
    <div className="flex flex-col items-center text-center">
      {icon}
      <h3 className="text-xl font-semibold text-foreground mb-1">{headline}</h3>
      {subtext && (
        <p className={`text-sm text-muted-foreground mb-6 ${maxWidthClass}`}>{subtext}</p>
      )}
      {dropzoneWrapper ? dropzoneWrapper(dropzone) : dropzone}
      <InboundEmailHint />
    </div>
  );
}
