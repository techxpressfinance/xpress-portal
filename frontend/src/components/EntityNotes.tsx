import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { Button, Card } from './ui';
import { formatDateTime, getErrorMessage } from '../lib/utils';
import type { EntityNote, EntityNoteCategory } from '../types';

// Backend copy: ENTITY_NOTE_CATEGORIES in app/models/entity_note.py.
const CATEGORIES: { value: EntityNoteCategory; label: string; hint: string; className: string }[] = [
  { value: 'general', label: 'General', hint: 'Anything worth knowing about the entity', className: 'bg-secondary text-foreground' },
  { value: 'financials', label: 'Financials', hint: 'Accountant, tax returns, BAS, trading figures', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  { value: 'compliance', label: 'Compliance', hint: 'ID / KYC, ASIC, ATO debts, anything a lender will ask', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  { value: 'relationship', label: 'Relationship', hint: 'Who to speak to, how they like to be contacted', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
];
const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.value, c])) as Record<EntityNoteCategory, (typeof CATEGORIES)[number]>;

function PinIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M7 3h6l-1 5 3 3H5l3-3-1-5zM10 11v6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** The entity's notes: a dated feed by the team (staff-only), pinned notes
 *  first, filterable by category and searchable. Notes from the entity's
 *  loans stay on each loan — ``onLoanNotes`` opens them all together. */
export default function EntityNotes({ organizationId, onLoanNotes }: { organizationId: string; onLoanNotes?: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [notes, setNotes] = useState<EntityNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [draftCategory, setDraftCategory] = useState<EntityNoteCategory>('general');
  const [draftPinned, setDraftPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<EntityNoteCategory | ''>('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string; category: EntityNoteCategory } | null>(null);

  const base = `/organizations/${organizationId}/notes`;

  useEffect(() => {
    let cancelled = false;
    api.get<EntityNote[]>(base)
      .then(({ data }) => { if (!cancelled) setNotes(data); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [base]);

  const counts = useMemo(() => {
    const out: Partial<Record<EntityNoteCategory, number>> = {};
    for (const n of notes ?? []) out[n.category] = (out[n.category] ?? 0) + 1;
    return out;
  }, [notes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes ?? []).filter((n) => (!filter || n.category === filter) && (!q || n.content.toLowerCase().includes(q) || (n.author_name ?? '').toLowerCase().includes(q)));
  }, [notes, filter, query]);

  const run = async (request: () => Promise<{ data: EntityNote[] }>, failure: string) => {
    try {
      const { data } = await request();
      setNotes(data);
      return true;
    } catch (err) {
      toast(getErrorMessage(err, failure), 'error');
      return false;
    }
  };

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    const ok = await run(() => api.post<EntityNote[]>(base, { content: draft, category: draftCategory, is_pinned: draftPinned }), 'Failed to add the note');
    setSaving(false);
    if (ok) {
      setDraft('');
      setDraftPinned(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.content.trim()) return;
    const ok = await run(() => api.patch<EntityNote[]>(`${base}/${editing.id}`, { content: editing.content, category: editing.category }), 'Failed to save');
    if (ok) setEditing(null);
  };

  const remove = async (n: EntityNote) => {
    const yes = await confirm({ title: 'Delete this note?', message: 'It is removed for the whole team.', confirmText: 'Delete', variant: 'danger' });
    if (yes) await run(() => api.delete<EntityNote[]>(`${base}/${n.id}`), 'Failed to delete');
  };

  const total = notes?.length ?? 0;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            Notes{total > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({total})</span>}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">For the team only — never shown to the client or a referrer.</p>
        </div>
        {onLoanNotes && (
          <button type="button" className="text-[12.5px] font-medium text-primary hover:underline" onClick={onLoanNotes}>
            Notes from this entity&rsquo;s loans
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="rounded-xl border border-border bg-secondary/30 p-3">
        <textarea
          className="led-input w-full min-h-[72px] resize-y py-2 text-[14px]"
          placeholder="Add a note — what the next person working with this entity should know"
          value={draft}
          maxLength={20000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }}
          aria-label="New note"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Note category">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={draftCategory === c.value}
                title={c.hint}
                onClick={() => setDraftCategory(c.value)}
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors ${draftCategory === c.value ? c.className + ' ring-1 ring-current' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <label className="ml-1 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <input type="checkbox" checked={draftPinned} onChange={(e) => setDraftPinned(e.target.checked)} />
            Pin to top
          </label>
          <Button size="sm" className="ml-auto" onClick={add} disabled={!draft.trim() || saving}>{saving ? 'Adding…' : 'Add note'}</Button>
        </div>
      </div>

      {/* Filters */}
      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show notes">
            {[{ value: '' as const, label: 'All', count: total }, ...CATEGORIES.filter((c) => counts[c.value]).map((c) => ({ value: c.value, label: c.label, count: counts[c.value] ?? 0 }))].map((f) => (
              <button
                key={f.value || 'all'}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${filter === f.value ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
          {total > 4 && (
            <input
              className="led-input !h-8 ml-auto w-48 text-[12.5px]"
              placeholder="Search notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search notes"
            />
          )}
        </div>
      )}

      {/* Feed */}
      {notes === null ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading notes…</p>
      ) : total === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No notes yet.</p>
      ) : shown.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No notes match.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {shown.map((n) => {
            const cat = CATEGORY[n.category] ?? CATEGORY.general;
            const isEditing = editing?.id === n.id;
            return (
              <li key={n.id} className={`rounded-xl border px-4 py-3 ${n.is_pinned ? 'border-primary/25 bg-primary/[0.03]' : 'border-border'}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                  <span className={`rounded px-1.5 py-px text-[11px] font-medium ${cat.className}`}>{cat.label}</span>
                  <span className="font-medium text-foreground">{n.author_name ?? 'Earlier notes'}</span>
                  <span>· {formatDateTime(n.created_at)}</span>
                  {n.updated_at && <span title={`Edited ${formatDateTime(n.updated_at)}${n.updated_by_name ? ` by ${n.updated_by_name}` : ''}`}>· edited</span>}
                  <span className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => run(() => api.patch<EntityNote[]>(`${base}/${n.id}`, { is_pinned: !n.is_pinned }), 'Failed to pin')}
                      className={`inline-flex items-center gap-1 ${n.is_pinned ? 'text-primary' : 'hover:text-foreground'}`}
                      aria-pressed={n.is_pinned}
                      title={n.is_pinned ? 'Unpin' : 'Pin to top'}
                    >
                      <PinIcon on={n.is_pinned} />{n.is_pinned && <span className="font-medium">Pinned</span>}
                    </button>
                    {n.can_edit && !isEditing && (
                      <>
                        <button type="button" className="font-medium hover:text-foreground" onClick={() => setEditing({ id: n.id, content: n.content, category: n.category })}>Edit</button>
                        <button type="button" className="font-medium hover:text-destructive" onClick={() => remove(n)}>Delete</button>
                      </>
                    )}
                  </span>
                </div>
                {isEditing && editing ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      className="led-input w-full min-h-[72px] resize-y py-2 text-[14px]"
                      value={editing.content}
                      maxLength={20000}
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      aria-label="Edit note"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="led-input !h-8 !w-auto text-[12.5px]"
                        value={editing.category}
                        onChange={(e) => setEditing({ ...editing, category: e.target.value as EntityNoteCategory })}
                        aria-label="Category"
                      >
                        {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <Button size="sm" onClick={saveEdit} disabled={!editing.content.trim()}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">{n.content}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
