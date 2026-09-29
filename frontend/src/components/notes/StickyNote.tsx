import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isAxiosError } from 'axios';
import { ExclamationTriangleIcon, ChevronRightIcon, PencilSquareIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import api from '../../api/client';
import { Button } from '../ui';
import { formatDateTime, getErrorMessage } from '../../lib/utils';
import type { Scratchpad } from '../../types';

const AUTOSAVE_MS = 1200;
const OPEN_KEY = 'stickyNoteOpen';

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * The loan's shared scratchpad as a sticky-notes drawer docked to the right
 * edge of the application page, on every tab: one free-form pad the whole team edits in
 * place, autosaved. If another broker saved after this pad was loaded, the
 * server refuses the save and the broker chooses whose version to keep.
 * Collapsing only hides it — the editor stays mounted so pending saves land.
 */
export default function StickyNote({ applicationId }: { applicationId: string }) {
  const [open, setOpenState] = useState(readOpen);
  const [pad, setPad] = useState<Scratchpad | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Scratchpad | null>(null);
  // The server version this editor is based on — sent with every save.
  const baseRef = useRef<string | null>(null);
  const textRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Scratchpad>(`/applications/${applicationId}/scratchpad`)
      .then(({ data }) => {
        if (cancelled) return;
        setPad(data);
        setText(data.content);
        textRef.current = data.content;
        baseRef.current = data.updated_at;
      })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err, 'Failed to load the scratchpad')); });
    return () => { cancelled = true; };
  }, [applicationId]);

  const save = useCallback(async (content: string, base: string | null) => {
    setState('saving');
    try {
      const { data } = await api.put<Scratchpad>(`/applications/${applicationId}/scratchpad`, {
        content,
        base_updated_at: base,
      });
      setPad(data);
      baseRef.current = data.updated_at;
      setConflict(null);
      // Typing may have continued while the request was out.
      setState(textRef.current === content ? 'saved' : 'dirty');
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        const theirs = (err.response.data as { detail?: { scratchpad?: Scratchpad } })?.detail?.scratchpad;
        if (theirs) {
          setConflict(theirs);
          setState('error');
          return;
        }
      }
      setState('error');
      setError(getErrorMessage(err, 'Failed to save the scratchpad'));
    }
  }, [applicationId]);

  // Flush a pending save when the tab or page is left.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void save(textRef.current, baseRef.current);
    }
  }, [save]);

  const onChange = (value: string) => {
    setText(value);
    textRef.current = value;
    setError(null);
    if (conflict) return; // hold saves until the conflict is resolved
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(value, baseRef.current);
    }, AUTOSAVE_MS);
  };

  const setOpen = (value: boolean) => {
    setOpenState(value);
    try { localStorage.setItem(OPEN_KEY, value ? '1' : '0'); } catch { /* per-viewer nicety only */ }
  };

  const takeTheirs = () => {
    if (!conflict) return;
    setText(conflict.content);
    textRef.current = conflict.content;
    baseRef.current = conflict.updated_at;
    setPad(conflict);
    setConflict(null);
    setState('saved');
  };

  const keepMine = () => {
    if (!conflict) return;
    void save(textRef.current, conflict.updated_at);
  };

  const status =
    state === 'saving' ? 'Saving…'
      : state === 'dirty' ? 'Unsaved changes'
      : pad?.updated_at ? `Saved · ${pad.updated_by_name || 'Staff'}, ${formatDateTime(pad.updated_at)}`
      : 'Nothing written yet';
  const hasContent = text.trim().length > 0;

  // Portalled: the page wrapper's enter animation leaves a transform that
  // would pin a fixed element to the page instead of the viewport.
  // Docked to the right edge; closed, it slides off-screen leaving only the tab.
  return createPortal(
    <div
      className={`fixed right-0 top-1/2 z-40 flex -translate-y-1/2 items-start transition-transform duration-300 ease-out print:hidden ${open ? 'translate-x-0' : 'translate-x-[calc(100%-2.25rem)]'}`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="relative mt-6 flex w-9 flex-col items-center gap-2 rounded-l-md bg-amber-200 py-3 text-[12px] font-semibold text-stone-800 shadow-[-4px_4px_12px_rgba(0,0,0,0.12)] ring-1 ring-amber-300 hover:bg-amber-300"
        title={open ? 'Hide sticky notes' : hasContent ? 'Open sticky notes' : 'Add sticky notes'}
      >
        <PencilSquareIcon className="h-4 w-4" strokeWidth={2} />
        <span className="[writing-mode:vertical-rl] rotate-180 tracking-wide">Sticky notes</span>
        {!open && (hasContent || state === 'error') && (
          <span className={`absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background ${state === 'error' ? 'bg-red-600' : 'bg-stone-700'}`} />
        )}
      </button>
      <div
        aria-hidden={!open}
        className="flex h-[420px] max-h-[80vh] w-[320px] max-w-[calc(100vw-3rem)] flex-col rounded-bl-md bg-amber-100 text-stone-800 shadow-xl ring-1 ring-amber-300/70 dark:bg-amber-200 dark:text-stone-900"
      >
        <div className="flex items-center justify-between bg-amber-200/80 px-3 py-1.5 dark:bg-amber-300">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-700">
            <PencilSquareIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Sticky notes
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            tabIndex={open ? 0 : -1}
            className="rounded p-0.5 text-stone-600 hover:bg-amber-300/70 hover:text-stone-900"
            title="Hide"
          >
            <ChevronRightIcon className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        {conflict && (
          <div className="mx-2.5 mt-2.5 rounded-md border border-amber-500/40 bg-amber-50 px-2.5 py-2 text-[12px]">
            <div className="flex items-start gap-1.5">
              <ExclamationTriangleIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700" strokeWidth={2} />
              <div className="flex-1">
                <p className="font-semibold">
                  {conflict.updated_by_name || 'Someone'} edited this {conflict.updated_at ? formatDateTime(conflict.updated_at) : ''} while you were writing.
                </p>
                <p className="mt-0.5 text-stone-600">Your text hasn't been saved. Keep one version:</p>
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={takeTheirs}>Use theirs</Button>
                  <Button size="sm" onClick={keepMine}>Keep mine</Button>
                </div>
              </div>
            </div>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={pad === null && !error}
          tabIndex={open ? 0 : -1}
          placeholder="Jot anything for this loan — numbers, to-dos, lender call notes. Saved automatically and shared with the team."
          className="flex-1 w-full resize-none bg-transparent px-3.5 py-2.5 text-[13.5px] leading-relaxed text-stone-800 placeholder-stone-500/80 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 border-t border-amber-300/60 px-3 py-1.5 text-[11px]">
          <span className="flex shrink-0 items-center gap-1 font-medium text-stone-600">
            <UserGroupIcon className="h-3 w-3" strokeWidth={2} />
            Team only
          </span>
          <span className={`truncate ${error ? 'text-red-700 font-medium' : 'text-stone-600'}`} title={error ?? status}>{error ?? status}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
