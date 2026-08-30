import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../types';
import { rafThrottle } from '../lib/utils';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

const initials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

/** Multi-broker assignment control: avatar stack (inline) or chip box (field) that
 *  opens a checkbox dropdown. */
export function BrokerPicker({
  brokers,
  selected,
  onChange,
  disabled,
  variant = 'inline',
}: {
  brokers: User[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  variant?: 'inline' | 'field';
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const menuWidth = 224; // w-56
    // Measure the actual rendered menu (it's mounted by the time this runs
    // inside the layout effect below); fall back to the max-h-64 cap as an
    // estimate before the menu has ever been measured.
    const menuHeight = menuRef.current?.offsetHeight || 256;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight || spaceBelow >= rect.top
      ? rect.bottom + 4
      : Math.max(4, rect.top - menuHeight - 4);
    // Align the menu's right edge with the trigger's right edge, clamped to stay on-screen.
    const left = Math.min(Math.max(4, rect.right - menuWidth), window.innerWidth - menuWidth - 4);
    setMenuStyle({ position: 'fixed', top, left, width: menuWidth, zIndex: 9999 });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const reposition = rafThrottle(() => updatePosition());
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      reposition.cancel();
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const openMenu = () => setOpen((v) => !v);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const selectedBrokers = brokers.filter((b) => selected.includes(b.id));

  return (
    <div className="relative" ref={ref}>
      {variant === 'inline' ? (
        <button
          type="button"
          onClick={() => !disabled && openMenu()}
          disabled={disabled}
          className="flex items-center gap-1.5 disabled:opacity-50"
        >
          {selectedBrokers.length > 0 ? (
            <div className="flex -space-x-1.5">
              {selectedBrokers.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  title={b.full_name}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-2 ring-card"
                >
                  {initials(b.full_name)}
                </div>
              ))}
              {selectedBrokers.length > 3 && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
                  +{selectedBrokers.length - 3}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[12px] rounded-lg border border-dashed border-border px-2 py-0.5 text-muted-foreground">
              Assign broker
            </span>
          )}
          <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => openMenu()}
          className="flex w-full flex-wrap items-center gap-1.5 min-h-[42px] rounded-lg border border-border bg-background px-3 py-2 text-left text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {selectedBrokers.length === 0 ? (
            <span className="text-muted-foreground">Unassigned</span>
          ) : (
            selectedBrokers.map((b) => (
              <span key={b.id} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium text-primary">
                {b.full_name}
              </span>
            ))
          )}
          <ChevronDownIcon className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        </button>
      )}

      {open && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="max-h-64 overflow-auto rounded-xl border border-border bg-card p-1 shadow-xl"
        >
          {brokers.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-muted-foreground">No brokers available</p>
          ) : (
            brokers.map((b) => {
              const checked = selected.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggle(b.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-secondary"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-white' : 'border-border'}`}>
                    {checked && (
                      <CheckIcon className="h-3 w-3" strokeWidth={3} />
                    )}
                  </span>
                  <span className="truncate">{b.full_name}</span>
                </button>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

/** Searchable single-client picker: a field-style trigger that opens a dropdown
 *  with a search box filtering clients by name or email. */
export function ClientPicker({
  clients,
  value,
  onChange,
  placeholder = 'Select client',
  allowClear = true,
  fallbackLabel,
}: {
  clients: User[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  fallbackLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePosition = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    // Measure the actual rendered menu (it's mounted by the time this runs
    // inside the layout effect below); fall back to the max-h-[300px] cap as
    // an estimate before the menu has ever been measured.
    const menuHeight = menuRef.current?.offsetHeight || 300;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight || spaceBelow >= rect.top
      ? rect.bottom + 4
      : Math.max(4, rect.top - menuHeight - 4);
    setMenuStyle({
      position: 'fixed',
      top,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    inputRef.current?.focus();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const reposition = rafThrottle(() => updatePosition());
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      reposition.cancel();
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const selected = clients.find((c) => c.id === value);
  const label = selected
    ? `${selected.full_name}${selected.email ? ` (${selected.email})` : ''}`
    : (value && fallbackLabel) || '';

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter((c) =>
        c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
    : clients;

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setQuery(''); setOpen((v) => !v); }}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <span className={`truncate ${label ? 'text-foreground' : 'text-muted-foreground'}`}>
          {label || placeholder}
        </span>
        <ChevronDownIcon className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="flex max-h-[300px] flex-col rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="overflow-auto p-1">
            {allowClear && (
              <button
                type="button"
                onClick={() => select('')}
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-secondary"
              >
                No client
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">No clients found</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-secondary ${c.id === value ? 'bg-secondary' : ''}`}
                >
                  <span className="truncate text-[13px] text-foreground">{c.full_name}</span>
                  {c.email && <span className="truncate text-[12px] text-muted-foreground">{c.email}</span>}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
