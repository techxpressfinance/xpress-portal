import { useEffect, useState } from 'react';
import {
  ClipboardDocumentCheckIcon,
  DocumentTextIcon,
  LightBulbIcon,
  LockClosedIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button } from '../ui';
import { formatDateTime, getErrorMessage } from '../../lib/utils';
import { notesForCategory, type FeedCategory } from '../../lib/notesHistory';
import type { ApplicationNote, DeclineReason, LenderSubmission, User } from '../../types';

const COPY: Record<FeedCategory, { empty: string; placeholder: string; added: string; Icon: typeof DocumentTextIcon }> = {
  general: {
    empty: 'No deal notes yet',
    placeholder: 'Write an internal note...',
    added: 'Deal note added',
    Icon: DocumentTextIcon,
  },
  compliance: {
    empty: 'No compliance notes yet',
    placeholder: 'e.g. Needs & objectives confirmed, credit guide sent, preliminary assessment done...',
    added: 'Compliance note added',
    Icon: ClipboardDocumentCheckIcon,
  },
  learning: {
    empty: 'No learnings recorded yet',
    placeholder: 'What would you do differently next time — with this client, this lender or this kind of deal?',
    added: 'Learning added',
    Icon: LightBulbIcon,
  },
  decline: {
    empty: 'No decline notes',
    placeholder: 'Why was it declined? What did the lender say, and what would it take to get it through?',
    added: 'Decline note added',
    Icon: NoSymbolIcon,
  },
};

const SELECT = 'h-8 rounded-lg bg-background border border-border px-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

function DeclineFields({
  submissions,
  reasons,
  submissionId,
  reasonId,
  onSubmission,
  onReason,
  onManageReasons,
}: {
  submissions: LenderSubmission[];
  reasons: DeclineReason[];
  submissionId: string;
  reasonId: string;
  onSubmission: (id: string) => void;
  onReason: (id: string) => void;
  onManageReasons?: () => void;
}) {
  // A retired reason stays selectable on a note that already carries it.
  const options = reasons.filter((r) => r.is_active || r.id === reasonId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={reasonId} onChange={(e) => onReason(e.target.value)} className={SELECT} aria-label="Decline reason">
        <option value="">Reason…</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>{r.label}{r.is_active ? '' : ' (retired)'}</option>
        ))}
      </select>
      <select value={submissionId} onChange={(e) => onSubmission(e.target.value)} className={SELECT} aria-label="Lender">
        <option value="">Not lender-specific</option>
        {submissions.map((s) => (
          <option key={s.id} value={s.id}>{s.lender_name || 'Lender'}{s.status === 'declined' ? ' (declined)' : ''}</option>
        ))}
      </select>
      {onManageReasons && (
        <button type="button" onClick={onManageReasons} className="text-[12px] font-medium text-primary hover:underline">
          Manage reasons
        </button>
      )}
    </div>
  );
}

/**
 * A loan's notes of one kind — Deal Notes, Compliance, My Learnings or Decline
 * Notes — with the add/edit/delete controls. The parent owns the note list (one
 * GET serves every tab) and is told about each change.
 */
export default function NoteFeed({
  applicationId,
  category,
  notes,
  currentUser,
  onCreated,
  onUpdated,
  onDeleted,
  submissions = [],
  declineReasons = [],
  onManageReasons,
  prefillSubmissionId,
}: {
  applicationId: string;
  category: FeedCategory;
  notes: ApplicationNote[];
  currentUser: User | null;
  onCreated: (note: ApplicationNote) => void;
  onUpdated: (note: ApplicationNote) => void;
  onDeleted: (note: ApplicationNote) => void;
  submissions?: LenderSubmission[];
  declineReasons?: DeclineReason[];
  /** Admins only — opens the decline-reason list editor. */
  onManageReasons?: () => void;
  /** Decline feed: preselect this lender (set when a submission is marked declined). */
  prefillSubmissionId?: string | null;
}) {
  const { toast } = useToast();
  const copy = COPY[category];
  const shown = notesForCategory(notes, category);
  const isDecline = category === 'decline';

  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'broker' | 'personal'>('broker');
  const [submissionId, setSubmissionId] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [sending, setSending] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSubmissionId, setEditSubmissionId] = useState('');
  const [editReasonId, setEditReasonId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (prefillSubmissionId) setSubmissionId(prefillSubmissionId);
  }, [prefillSubmissionId]);

  const add = async () => {
    if (!content.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post<ApplicationNote>(`/applications/${applicationId}/notes`, {
        content: content.trim(),
        category,
        visibility: [category === 'general' ? visibility : 'broker'],
        ...(isDecline ? { lender_submission_id: submissionId || null, decline_reason_id: reasonId || null } : {}),
      });
      onCreated(data);
      setContent('');
      setSubmissionId('');
      setReasonId('');
      toast(copy.added, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save note'), 'error');
    } finally {
      setSending(false);
    }
  };

  const startEdit = (note: ApplicationNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setEditSubmissionId(note.lender_submission_id ?? '');
    setEditReasonId(note.decline_reason_id ?? '');
  };

  const saveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    setSavingEdit(true);
    try {
      const { data } = await api.patch<ApplicationNote>(`/applications/${applicationId}/notes/${editingId}`, {
        content: editContent.trim(),
        ...(isDecline ? { lender_submission_id: editSubmissionId || null, decline_reason_id: editReasonId || null } : {}),
      });
      onUpdated(data);
      setEditingId(null);
      toast('Note updated', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update note'), 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (note: ApplicationNote) => {
    try {
      await api.delete(`/applications/${applicationId}/notes/${note.id}`);
      onDeleted(note);
      toast('Note deleted', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete'), 'error');
    }
  };

  return (
    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
            <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
              <copy.Icon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium text-muted-foreground">{copy.empty}</p>
          </div>
        ) : (
          shown.map((note) => {
            const isPersonal = note.visibility[0] === 'personal';
            return (
              <div key={note.id} className="flex flex-col gap-1.5 group/note">
                <div className="flex items-baseline justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{note.author_name || 'Staff'}</span>
                    {note.author_role && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground capitalize uppercase tracking-wider">{note.author_role}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {(currentUser?.role === 'admin' || note.author_id === currentUser?.id) && (
                      <button
                        onClick={() => startEdit(note)}
                        className="opacity-0 group-hover/note:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary"
                        title="Edit"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                    <button
                      onClick={() => remove(note)}
                      className="opacity-0 group-hover/note:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <TrashIcon className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <span className="text-[11px] font-medium text-muted-foreground">{formatDateTime(note.created_at)}</span>
                  </div>
                </div>
                <div className={`rounded-2xl p-3.5 text-[14px] leading-relaxed text-foreground border ${isPersonal ? 'bg-amber-500/8 border-amber-500/20' : 'bg-secondary/40 border-transparent'}`}>
                  {editingId === note.id ? (
                    <div className="space-y-2">
                      {isDecline && (
                        <DeclineFields
                          submissions={submissions}
                          reasons={declineReasons}
                          submissionId={editSubmissionId}
                          reasonId={editReasonId}
                          onSubmission={setEditSubmissionId}
                          onReason={setEditReasonId}
                        />
                      )}
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        autoFocus
                        className="w-full rounded-lg bg-background border border-border px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={savingEdit}>Cancel</Button>
                        <Button size="sm" onClick={saveEdit} loading={savingEdit} disabled={!editContent.trim()}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isDecline && (note.decline_reason || note.lender_name) && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {note.decline_reason && (
                            <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{note.decline_reason}</span>
                          )}
                          {note.lender_name && (
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{note.lender_name}</span>
                          )}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{note.content}</p>
                    </>
                  )}
                  <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border/30">
                    <LockClosedIcon className="h-3.5 w-3.5 opacity-60 shrink-0" strokeWidth={2} />
                    <span className="text-[11px] font-medium opacity-60">{isPersonal ? 'Only you' : 'Internal (Brokers only)'}</span>
                    {note.updated_at && (
                      <span className="ml-auto text-[11px] opacity-60">
                        Edited{note.updated_by_name ? ` by ${note.updated_by_name}` : ''} {formatDateTime(note.updated_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-primary/50 focus-within:bg-secondary/60 transition-all duration-300 flex flex-col pt-1">
        {isDecline && (
          <div className="px-3 pt-2">
            <DeclineFields
              submissions={submissions}
              reasons={declineReasons}
              submissionId={submissionId}
              reasonId={reasonId}
              onSubmission={setSubmissionId}
              onReason={setReasonId}
              onManageReasons={onManageReasons}
            />
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
          placeholder={copy.placeholder}
        />
        <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-border/30 mt-1">
          {category === 'general' ? (
            <button
              type="button"
              onClick={() => setVisibility((v) => (v === 'broker' ? 'personal' : 'broker'))}
              className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-lg transition-colors ${visibility === 'personal' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
              title={visibility === 'personal' ? 'Only visible to you — click to share with team' : 'Visible to all brokers — click to make private'}
            >
              {visibility === 'personal' ? (
                <>
                  <UserIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  Only me
                </>
              ) : (
                <>
                  <UserGroupIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  Team
                </>
              )}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground" title="Shared with every broker and admin — never the client or a referrer">
              <UserGroupIcon className="h-3.5 w-3.5" strokeWidth={2} />
              Team only
            </span>
          )}
          <Button size="sm" className="rounded-xl px-4 h-9" loading={sending} disabled={!content.trim()} onClick={add}>
            <PlusIcon className="h-4 w-4 mr-1.5" strokeWidth={2} />
            Add Note
          </Button>
        </div>
      </div>
    </div>
  );
}
