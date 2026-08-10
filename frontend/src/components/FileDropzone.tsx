import { useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_MB = 10;

/** Clipboard image mime → extension the backend attachment validator accepts. */
const PASTE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

/**
 * Paste listeners of every mounted dropzone, oldest first. A paste is a page-level
 * event, so only the most recently mounted zone handles it — otherwise two zones on
 * one page would each upload the same screenshot.
 */
const pasteHandlers: ((e: ClipboardEvent) => void)[] = [];

function pastedImage(e: ClipboardEvent): File | null {
  const items = Array.from(e.clipboardData?.items ?? []);
  const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  return item?.getAsFile() ?? null;
}

interface Props {
  uploading: boolean;
  onFile: (file: File) => void;
  onError?: (msg: string) => void;
  accept?: string;
  hint?: string;
  /** Client-side size cap. Raise it where the server allows larger uploads
   *  (dropped emails are capped at 15 MB, not 10). */
  maxSizeMb?: number;
  /** Replaces the default "Drop a file…" copy — e.g. to mention dropped emails. */
  prompt?: string;
}

/** Generic drag-and-drop / paste / click-to-browse file upload zone (screenshots, PDFs, etc). */
export default function FileDropzone({
  uploading,
  onFile,
  onError,
  accept = '.pdf,.jpg,.jpeg,.png',
  hint = 'PDF, JPG, PNG — up to 10 MB',
  maxSizeMb = DEFAULT_MAX_MB,
  prompt,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (file.size > maxSizeMb * 1024 * 1024) {
      onError?.(`File size exceeds ${maxSizeMb}MB limit`);
      return;
    }
    onFile(file);
    if (fileInput.current) fileInput.current.value = '';
  };

  /* Keep the latest props for the paste listener without re-registering it each render. */
  const latest = useRef({ uploading, handleFile, onError });
  useEffect(() => {
    latest.current = { uploading, handleFile, onError };
  });

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const { uploading: busy, handleFile: upload, onError: err } = latest.current;
      if (busy) return;

      // Rich-text targets insert the image themselves — don't also upload it.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[contenteditable="true"]')) return;

      const image = pastedImage(e);
      if (!image) return;
      e.preventDefault();

      const ext = PASTE_EXTENSIONS[image.type];
      if (!ext) {
        err?.('Pasted image must be PNG or JPG');
        return;
      }

      // Clipboard files arrive unnamed or as a generic "image.png" — stamp them so
      // several pasted screenshots stay distinguishable in the attachment list.
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      upload(new File([image], `screenshot-${stamp}.${ext}`, { type: image.type }));
    };

    pasteHandlers.push(onPaste);
    const dispatch = (e: ClipboardEvent) => {
      if (pasteHandlers[pasteHandlers.length - 1] === onPaste) onPaste(e);
    };
    document.addEventListener('paste', dispatch);
    return () => {
      document.removeEventListener('paste', dispatch);
      pasteHandlers.splice(pasteHandlers.indexOf(onPaste), 1);
    };
  }, []);

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
                  <span className="hidden sm:inline">{prompt ?? 'Drop a file, click to browse, or paste a screenshot'}</span>
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
