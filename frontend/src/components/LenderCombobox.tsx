import { useId, useMemo, useRef, useState } from 'react';
import { ChevronUpDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { Lender } from '../types';

/**
 * Type-to-search picker over the tenant's lender book, in place of a long
 * <select>. Typing filters by name — names that start with what was typed come
 * first, then any containing it — and the arrow keys, Enter and Escape work as
 * in a native combobox.
 *
 * The input shows the chosen lender's name while it isn't being typed into, so
 * it reads like the select it replaces. A lender retired from the book after
 * it was chosen still shows (`orphanedName`), or re-saving would drop it.
 */
export default function LenderCombobox({
  id,
  lenders,
  value,
  orphanedName,
  onChange,
  className = '',
}: {
  id?: string;
  /** null while the book is still loading. */
  lenders: Lender[] | null;
  value: string | null;
  orphanedName?: string | null;
  onChange: (lenderId: string) => void;
  /** Sizing/typography for the input, so each form keeps its own look. */
  className?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = lenders?.find(l => l.id === value) ?? null;
  const selectedLabel = selected
    ? `${selected.name}${selected.is_active ? '' : ' (inactive)'}`
    : value && orphanedName ? `${orphanedName} (no longer listed)` : '';

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const book = lenders ?? [];
    if (!q) return book;
    const starts = book.filter(l => l.name.toLowerCase().startsWith(q));
    const contains = book.filter(l => !l.name.toLowerCase().startsWith(q) && l.name.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [lenders, query]);

  const openList = () => {
    setQuery('');
    setActive(Math.max(0, matches.findIndex(l => l.id === value)));
    setOpen(true);
  };

  const choose = (lender: Lender) => {
    onChange(lender.id);
    setOpen(false);
    setQuery('');
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => (matches.length ? (i + step + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      }
    }
  };

  const loading = lenders == null;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        autoComplete="off"
        disabled={loading}
        placeholder={loading ? 'Loading lenders…' : 'Type to search lenders…'}
        value={open ? query : selectedLabel}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className={`w-full pr-16 ${className}`}
      />
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
        {value && !open && !loading && (
          // Clearing is a deliberate act, so it needs the pointer — the rest of
          // the adornment lets clicks through to the input.
          <button
            type="button"
            aria-label="Clear lender"
            className="pointer-events-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onChange(''); inputRef.current?.focus(); }}
          >
            <XMarkIcon className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
        <ChevronUpDownIcon className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted-foreground">
              {lenders?.length ? `No lender matches “${query.trim()}”` : 'No lenders in the book yet'}
            </li>
          ) : (
            matches.map((l, i) => (
              <li
                key={l.id}
                id={`${listId}-${l.id}`}
                role="option"
                aria-selected={l.id === value}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={e => { e.preventDefault(); choose(l); }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[14px] ${
                  i === active ? 'bg-secondary' : ''
                } ${l.id === value ? 'font-semibold text-foreground' : 'text-foreground'}`}
              >
                <span className="truncate">{l.name}</span>
                {!l.is_active && <span className="shrink-0 text-[11px] text-muted-foreground">inactive</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
