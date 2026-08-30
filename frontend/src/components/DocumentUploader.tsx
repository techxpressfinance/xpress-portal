import { useRef, useState } from 'react';
import { DOC_TYPE_LABELS } from '../lib/constants';
import type { DocType } from '../types';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';

const MAX_SIZE = 10 * 1024 * 1024;

interface Props {
  docType: DocType;
  onDocTypeChange: (type: DocType) => void;
  uploading: boolean;
  onFile: (file: File, label?: string) => void;
  /** Always show optional label field (used by broker/admin uploaders) */
  showLabel?: boolean;
  fileLabel?: string;
  onFileLabelChange?: (label: string) => void;
  onError?: (msg: string) => void;
}

export default function DocumentUploader({
  docType,
  onDocTypeChange,
  uploading,
  onFile,
  showLabel: alwaysShowLabel = false,
  fileLabel: externalFileLabel = '',
  onFileLabelChange,
  onError,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [internalLabel, setInternalLabel] = useState('');

  // Show label field when docType is "other" or when alwaysShowLabel is true
  const isOtherType = docType === 'other';
  const showLabelField = alwaysShowLabel || isOtherType;

  // Use external label if provided, otherwise use internal state
  const fileLabel = externalFileLabel !== undefined ? externalFileLabel : internalLabel;
  const handleLabelChange = (value: string) => {
    if (onFileLabelChange) {
      onFileLabelChange(value);
    } else {
      setInternalLabel(value);
    }
  };

  const handleFile = (file: File) => {
    if (file.size > MAX_SIZE) {
      onError?.('File size exceeds 10MB limit');
      return;
    }
    // Pass the label only when "other" is selected
    const labelToPass = isOtherType ? fileLabel : undefined;
    onFile(file, labelToPass);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="space-y-3">
      {/* Doc type selector */}
      <div>
        <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Document Type</label>
        <select
          value={docType}
          onChange={(e) => onDocTypeChange(e.target.value as DocType)}
          className="led-input"
          disabled={uploading}
        >
          {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Optional label - shown for "other" doc type or when alwaysShowLabel is true */}
      {showLabelField && (
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            {isOtherType ? 'Document Name' : 'Label'} <span className="font-normal">(optional)</span>
          </label>
          <input
            type="text"
            className="led-input"
            placeholder={isOtherType ? 'e.g. Custom document description' : DOC_TYPE_LABELS[docType] || 'e.g. June payslip'}
            value={fileLabel}
            onChange={(e) => handleLabelChange(e.target.value)}
            disabled={uploading}
          />
        </div>
      )}

      {/* Drag-and-drop zone */}
      <div
        className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 sm:py-6 text-center transition-colors ${uploading ? 'opacity-50 pointer-events-none' : isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-secondary/40'}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          disabled={uploading}
        />
        {uploading ? (
          <>
            <svg className="h-5 w-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-[13px] font-medium text-primary">Uploading…</p>
          </>
        ) : (
          <>
            <div className={`flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full transition-colors ${isDragOver ? 'bg-primary/15' : 'bg-secondary'}`}>
              <ArrowUpTrayIcon className={`h-5 w-5 sm:h-4 sm:w-4 transition-colors ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-[14px] sm:text-[13px] font-medium text-foreground">
                {isDragOver ? 'Drop to upload' : (
                  <>
                    <span className="sm:hidden">Tap to upload a file</span>
                    <span className="hidden sm:inline">Drop a file or click to browse</span>
                  </>
                )}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">PDF, JPG, PNG — up to 10 MB</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
