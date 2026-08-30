import { useEffect, useRef, useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';

const DEFAULT_MAX_MB = 10;

/** Clipboard image mime → extension the backend attachment validator accepts. */
const PASTE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

/**
 * Paste listeners of every mounted dropzone, oldest first. A paste is a page-level
 * event, so only one zone handles it — otherwise two zones on one page would each
 * upload the same screenshot. The winner is the highest `pastePriority`, ties going
 * to the most recently mounted, so a zone the user has deliberately opened (an
 * attempt's evidence field) can claim the paste over a passive zone further down
 * the page that merely happens to have mounted later.
 */
const pasteHandlers: { fn: (e: ClipboardEvent) => void; priority: number }[] = [];

const pasteWinner = () =>
  pasteHandlers.reduce<typeof pasteHandlers[number] | null>(
    (best, h) => (best === null || h.priority >= best.priority ? h : best),
    null,
  );

/** Read a virtual-file entry into a real File. */
const entryToFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/**
 * The files behind a drop.
 *
 * A message dragged out of the Outlook *desktop* client never reaches
 * `dataTransfer.files`: Outlook offers it as a promised "virtual file"
 * (CFSTR_FILEDESCRIPTOR + FILECONTENTS) rather than a path on disk, and Chrome
 * surfaces those only through `webkitGetAsEntry()`. Reading `.files` alone
 * drops every dragged email on the floor.
 *
 * `webkitGetAsEntry()` must be called synchronously — the drag data store is
 * emptied the moment the drop handler returns — so the entries are collected up
 * front and only their contents are awaited.
 */
function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const direct = Array.from(dt.files ?? []);
  if (direct.length) return Promise.resolve(direct);

  const entries = Array.from(dt.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemFileEntry => !!entry && entry.isFile);

  return Promise.all(entries.map(entryToFile));
}

/** True when a drop carried only a link — what Gmail and Outlook Web hand over. */
const isLinkOnlyDrop = (dt: DataTransfer) => {
  const types = Array.from(dt.types ?? []);
  return (
    !types.includes('Files') &&
    (types.includes('text/uri-list') || types.includes('text/html') || types.includes('text/plain'))
  );
};

/** Every image on the clipboard — a paste can carry several, and taking only
 *  the first silently loses the rest. */
function pastedImages(e: ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

interface Props {
  uploading: boolean;
  /** Called once per accepted file. Return a promise to have a multi-file
   *  drop uploaded one at a time instead of all at once. */
  onFile: (file: File) => void | Promise<unknown>;
  onError?: (msg: string) => void;
  accept?: string;
  hint?: string;
  /** Client-side size cap. Raise it where the server allows larger uploads
   *  (dropped emails are capped at 15 MB, not 10). */
  maxSizeMb?: number;
  /** Replaces the default "Drop a file…" copy — e.g. to mention dropped emails. */
  prompt?: string;
  /** Higher wins the page-level paste when several zones are on screen. */
  pastePriority?: number;
  /** Accept a whole batch — a multi-file drop, a multi-select in the browser
   *  dialog, or several images on the clipboard. Off by default so existing
   *  single-file callers keep their behaviour. */
  multiple?: boolean;
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
  pastePriority = 0,
  multiple = false,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * Hand the files up one at a time, awaiting each. Uploads that all fire at
   * once race each other's responses (every arrears upload returns the whole
   * record), so the list would settle on whichever landed last and appear to
   * have swallowed the others.
   */
  const handleFiles = async (files: File[]) => {
    const accepted = files.filter((f) => {
      if (f.size > maxSizeMb * 1024 * 1024) {
        onError?.(`${f.name} exceeds the ${maxSizeMb}MB limit`);
        return false;
      }
      return true;
    });
    if (fileInput.current) fileInput.current.value = '';
    for (const file of multiple ? accepted : accepted.slice(0, 1)) {
      await onFile(file);
    }
  };

  /* Keep the latest props for the paste listener without re-registering it each render. */
  const latest = useRef({ uploading, handleFiles, onError });
  useEffect(() => {
    latest.current = { uploading, handleFiles, onError };
  });

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const { uploading: busy, handleFiles: upload, onError: err } = latest.current;
      if (busy) return;

      // Rich-text targets insert the image themselves — don't also upload it.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[contenteditable="true"]')) return;

      const images = pastedImages(e);
      if (images.length === 0) return;
      e.preventDefault();

      const named: File[] = [];
      images.forEach((image, i) => {
        const ext = PASTE_EXTENSIONS[image.type];
        if (!ext) {
          err?.('Pasted image must be PNG or JPG');
          return;
        }
        // Clipboard files arrive unnamed or as a generic "image.png" — stamp them
        // so several pasted screenshots stay distinguishable in the list, with a
        // counter in case two land inside the same second.
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const suffix = images.length > 1 ? `-${i + 1}` : '';
        named.push(new File([image], `screenshot-${stamp}${suffix}.${ext}`, { type: image.type }));
      });
      if (named.length) upload(named);
    };

    const entry = { fn: onPaste, priority: pastePriority };
    pasteHandlers.push(entry);
    const dispatch = (e: ClipboardEvent) => {
      if (pasteWinner() === entry) onPaste(e);
    };
    document.addEventListener('paste', dispatch);
    return () => {
      document.removeEventListener('paste', dispatch);
      pasteHandlers.splice(pasteHandlers.indexOf(entry), 1);
    };
  }, [pastePriority]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 sm:py-5 text-center transition-colors ${uploading ? 'opacity-50 pointer-events-none' : isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-secondary/40'}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const linkOnly = isLinkOnlyDrop(e.dataTransfer);
        // Collect synchronously: the drag data store dies with this handler.
        droppedFiles(e.dataTransfer)
          .then((files) => {
            if (files.length) {
              handleFiles(files);
            } else if (linkOnly) {
              onError?.(
                'That drag carried only a link. Gmail and Outlook Web can\'t hand over the message itself — save it as .eml and drop that, or paste a screenshot.',
              );
            } else {
              onError?.("That drop didn't contain a file. Try dragging the message again, or click to browse.");
            }
          })
          .catch(() => onError?.('Could not read the dropped file. Try saving it to disk first, then drop it.'));
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept={accept}
        multiple={multiple}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) handleFiles(files);
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
