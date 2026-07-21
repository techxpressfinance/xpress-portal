import { useRef, useState } from 'react';

const MAX_SIZE = 10 * 1024 * 1024;

interface Props {
  uploading: boolean;
  onFile: (file: File) => void;
  onError?: (msg: string) => void;
  accept?: string;
  hint?: string;
}

/** Generic drag-and-drop / click-to-browse file upload zone (screenshots, PDFs, etc). */
export default function FileDropzone({
  uploading,
  onFile,
  onError,
  accept = '.pdf,.jpg,.jpeg,.png',
  hint = 'PDF, JPG, PNG — up to 10 MB',
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (file.size > MAX_SIZE) {
      onError?.('File size exceeds 10MB limit');
      return;
    }
    onFile(file);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 sm:py-5 text-center transition-colors ${uploading ? 'opacity-50 pointer-events-none' : isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-secondary/40'}`}
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
        accept={accept}
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
            <svg className={`h-5 w-5 sm:h-4 sm:w-4 transition-colors ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
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
            <p className="text-[12px] text-muted-foreground mt-0.5">{hint}</p>
          </div>
        </>
      )}
    </div>
  );
}
