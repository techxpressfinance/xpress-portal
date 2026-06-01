import { useCallback, useState } from 'react';
import api from '../api/client';
import type { LoanApplication } from '../types';

const COMMERCIAL_TYPES = ['business', 'business_loan', 'commercial_property', 'equipment_finance'];

interface Props {
  application: LoanApplication;
  /** Refetch the application after a mutation. */
  onChange: () => void | Promise<void>;
  /** Allow adding/removing/inviting directors. */
  canManage?: boolean;
  /** Allow clearing the reconciliation flag (broker/admin). */
  canReconcile?: boolean;
}

export default function DirectorsSection({ application, onChange, canManage = false, canReconcile = false }: Props) {
  const [newDirectorEmail, setNewDirectorEmail] = useState('');
  const [newDirectorRole, setNewDirectorRole] = useState('director');
  const [addingDirector, setAddingDirector] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const handleAddDirector = useCallback(async () => {
    setAddingDirector(true);
    try {
      const email = newDirectorEmail.trim();
      await api.post(`/applications/${application.id}/directors`, {
        role: newDirectorRole,
        ...(email ? { invite_email: email } : {}),
      });
      setNewDirectorEmail('');
      setNewDirectorRole('director');
      await onChange();
    } catch {
      alert('Failed to add director');
    } finally {
      setAddingDirector(false);
    }
  }, [application.id, newDirectorEmail, newDirectorRole, onChange]);

  const handleRemoveDirector = useCallback(async (applicantId: string) => {
    if (!confirm('Remove this director from the application?')) return;
    try {
      await api.delete(`/applications/${application.id}/directors/${applicantId}`);
      await onChange();
    } catch {
      alert('Failed to remove director');
    }
  }, [application.id, onChange]);

  const handleReconcile = useCallback(async () => {
    setReconciling(true);
    try {
      await api.post(`/applications/${application.id}/reconcile`, {});
      await onChange();
    } catch {
      alert('Failed to resolve');
    } finally {
      setReconciling(false);
    }
  }, [application.id, onChange]);

  if (!COMMERCIAL_TYPES.includes(application.loan_type)) return null;

  const directors = application.additional_applicants || [];
  const roleLabel = (role?: string | null) => (role === 'guarantor' ? 'Guarantor' : 'Director');

  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-muted-foreground">Directors</h3>
        <span className="text-[12px] text-muted-foreground">
          {1 + directors.length} of {application.num_directors ?? '—'}
        </span>
      </div>

      {application.needs_reconciliation && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="font-semibold">Needs reconciliation. </span>
              {application.reconciliation_note || 'Another application may exist for the same company.'}
            </div>
            {canReconcile && (
              <button
                onClick={handleReconcile}
                disabled={reconciling}
                className="shrink-0 rounded bg-amber-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {reconciling ? 'Resolving…' : 'Mark resolved'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {/* Primary director (inline applicant) */}
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div className="text-[14px] text-foreground">
            {[application.applicant_first_name, application.applicant_last_name].filter(Boolean).join(' ') || 'Primary applicant'}
            <span className="ml-2 text-[12px] text-muted-foreground">Director · Primary</span>
          </div>
          <span className="text-[12px] text-muted-foreground">
            {application.signature_name ? 'Signed' : 'Unsigned'}
          </span>
        </div>

        {directors.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="text-[14px] text-foreground">
              {[d.applicant_first_name, d.applicant_last_name].filter(Boolean).join(' ') || d.invite_email || roleLabel(d.role)}
              <span className="ml-2 text-[12px] text-muted-foreground">
                {roleLabel(d.role)} · {d.completed_at ? (d.signed_at ? 'Signed' : 'Completed, unsigned') : d.invite_sent_at ? 'Invite sent' : 'Pending'}
              </span>
            </div>
            {canManage && (
              <button
                onClick={() => handleRemoveDirector(d.id)}
                className="text-[12px] text-destructive hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="mt-3 flex items-center gap-2">
          <select
            value={newDirectorRole}
            onChange={(e) => setNewDirectorRole(e.target.value)}
            className="shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-[13px]"
          >
            <option value="director">Director</option>
            <option value="guarantor">Guarantor</option>
          </select>
          <input
            type="email"
            value={newDirectorEmail}
            onChange={(e) => setNewDirectorEmail(e.target.value)}
            placeholder="Email (optional, sends invite)"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
          />
          <button
            onClick={handleAddDirector}
            disabled={addingDirector}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {addingDirector ? 'Adding…' : 'Add director'}
          </button>
        </div>
      )}
    </div>
  );
}
