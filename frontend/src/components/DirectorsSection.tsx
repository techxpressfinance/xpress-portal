import { useCallback, useState } from 'react';
import api from '../api/client';
import { CopyButton } from './ui/CopyButton';
import type { LoanApplication, LoanApplicant } from '../types';

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

const roleLabel = (role?: string | null) => (role === 'guarantor' ? 'Guarantor' : 'Director');

const partyStatus = (d: LoanApplicant) =>
  d.completed_at ? (d.signed_at ? 'Signed' : 'Completed, unsigned') : d.invite_sent_at ? 'Invite sent' : 'Pending';

export default function DirectorsSection({ application, onChange, canManage = false, canReconcile = false }: Props) {
  const [newDirectorEmail, setNewDirectorEmail] = useState('');
  const [newDirectorRole, setNewDirectorRole] = useState('director');
  const [addingDirector, setAddingDirector] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  // Corporate guarantor form
  const [gName, setGName] = useState('');
  const [gAbn, setGAbn] = useState('');
  const [addingGuarantor, setAddingGuarantor] = useState(false);
  // Per-guarantor signatory email input + in-flight id
  const [sigEmails, setSigEmails] = useState<Record<string, string>>({});
  const [busyGuarantor, setBusyGuarantor] = useState<string | null>(null);

  const handleAddDirector = useCallback(async () => {
    const email = newDirectorEmail.trim();
    if (!email) {
      alert('An email is required — the director/guarantor is invited to complete their own details.');
      return;
    }
    setAddingDirector(true);
    try {
      await api.post(`/applications/${application.id}/directors`, {
        role: newDirectorRole,
        invite_email: email,
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
    if (!confirm('Remove this person from the application?')) return;
    try {
      await api.delete(`/applications/${application.id}/directors/${applicantId}`);
      await onChange();
    } catch {
      alert('Failed to remove');
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

  const handleAddGuarantor = useCallback(async () => {
    const name = gName.trim();
    const abn = gAbn.trim();
    if (!name && !abn) {
      alert('Enter the guarantor company name or ABN.');
      return;
    }
    setAddingGuarantor(true);
    try {
      await api.post(`/applications/${application.id}/guarantors`, {
        ...(name ? { business_name: name } : {}),
        ...(abn ? { business_abn: abn } : {}),
      });
      setGName('');
      setGAbn('');
      await onChange();
    } catch {
      alert('Failed to add corporate guarantor');
    } finally {
      setAddingGuarantor(false);
    }
  }, [application.id, gName, gAbn, onChange]);

  const handleRemoveGuarantor = useCallback(async (guarantorId: string) => {
    if (!confirm('Remove this corporate guarantor and all its signatories?')) return;
    try {
      await api.delete(`/applications/${application.id}/guarantors/${guarantorId}`);
      await onChange();
    } catch {
      alert('Failed to remove corporate guarantor');
    }
  }, [application.id, onChange]);

  const handleAddSignatory = useCallback(async (guarantorId: string) => {
    const email = (sigEmails[guarantorId] || '').trim();
    if (!email) {
      alert('An email is required — the director is invited to sign the guarantee.');
      return;
    }
    setBusyGuarantor(guarantorId);
    try {
      await api.post(`/applications/${application.id}/guarantors/${guarantorId}/signatories`, {
        invite_email: email,
      });
      setSigEmails((prev) => ({ ...prev, [guarantorId]: '' }));
      await onChange();
    } catch {
      alert('Failed to add signatory');
    } finally {
      setBusyGuarantor(null);
    }
  }, [application.id, sigEmails, onChange]);

  if (!COMMERCIAL_TYPES.includes(application.loan_type)) return null;

  const directors = application.additional_applicants || [];
  const guarantors = application.corporate_guarantors || [];

  // Legacy applicant-first apps carry an inline primary; entity-first apps don't.
  // Only show the separate primary card when there is real inline data.
  const hasInlinePrimary = Boolean(application.applicant_first_name || application.applicant_last_name);
  const partyCount = (hasInlinePrimary ? 1 : 0) + directors.length;
  const hasAnyParty = partyCount > 0 || guarantors.length > 0;

  const partyRow = (d: LoanApplicant) => (
    <div key={d.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <div className="text-[14px] text-foreground">
        {[d.applicant_first_name, d.applicant_last_name].filter(Boolean).join(' ') || d.invite_email || roleLabel(d.role)}
        <span className="ml-2 text-[12px] text-muted-foreground">{roleLabel(d.role)} · {partyStatus(d)}</span>
      </div>
      <div className="flex items-center gap-2">
        {d.invite_url && (
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground" title="Copy this party's invite link to share directly">
            Invite link
            <CopyButton text={d.invite_url} size="sm" />
          </span>
        )}
        {canManage && (
          <button onClick={() => handleRemoveDirector(d.id)} className="text-[12px] text-destructive hover:underline">
            Remove
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-muted-foreground">Directors &amp; guarantors</h3>
        <span className="text-[12px] text-muted-foreground">
          {partyCount} of {application.num_directors ?? '—'}
        </span>
      </div>

      {hasAnyParty && (
        <div className={`mb-4 rounded-md border px-3 py-2 text-[12px] ${application.parties_ready ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-border bg-muted/40 text-muted-foreground'}`}>
          {application.parties_ready
            ? 'All parties have completed and signed their details.'
            : 'Waiting on one or more parties to complete and sign.'}
        </div>
      )}

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
        {/* Primary director — only legacy applicant-first apps have inline data */}
        {hasInlinePrimary && (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="text-[14px] text-foreground">
              {[application.applicant_first_name, application.applicant_last_name].filter(Boolean).join(' ')}
              <span className="ml-2 text-[12px] text-muted-foreground">Director · Primary</span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {application.signature_name ? 'Signed' : 'Unsigned'}
            </span>
          </div>
        )}

        {directors.length === 0 && !hasInlinePrimary && (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">
            No parties yet. Add each director and guarantor below — they'll be emailed a link to complete their details.
          </div>
        )}

        {directors.map(partyRow)}
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
            placeholder="Email (required, sends invite)"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
          />
          <button
            onClick={handleAddDirector}
            disabled={addingDirector || !newDirectorEmail.trim()}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {addingDirector ? 'Adding…' : 'Add & invite'}
          </button>
        </div>
      )}

      {/* Corporate guarantors — a company guaranteeing the loan; each of its directors signs */}
      <div className="mt-6">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Corporate guarantors
        </h4>

        {guarantors.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            No company guarantors. Add a guarantor company below — each of its directors will be invited to sign.
          </p>
        )}

        <div className="space-y-3">
          {guarantors.map((g) => (
            <div key={g.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-medium text-foreground">
                  {g.organization_name || 'Company'}
                  {g.organization_abn && <span className="ml-2 text-[12px] text-muted-foreground">ABN {g.organization_abn}</span>}
                  <span className={`ml-2 text-[12px] ${g.ready ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                    · {g.ready ? 'All signed' : `${g.signatories.filter((s) => s.signed_at).length}/${g.signatories.length} signed`}
                  </span>
                </div>
                {canManage && (
                  <button onClick={() => handleRemoveGuarantor(g.id)} className="text-[12px] text-destructive hover:underline">
                    Remove
                  </button>
                )}
              </div>

              <div className="mt-2 space-y-2 pl-3 border-l-2 border-border">
                {g.signatories.length === 0 && (
                  <p className="text-[12px] text-muted-foreground">No signatories yet — add the company's directors.</p>
                )}
                {g.signatories.map(partyRow)}
              </div>

              {canManage && (
                <div className="mt-2 flex items-center gap-2 pl-3">
                  <input
                    type="email"
                    value={sigEmails[g.id] || ''}
                    onChange={(e) => setSigEmails((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    placeholder="Director email (required, sends invite)"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
                  />
                  <button
                    onClick={() => handleAddSignatory(g.id)}
                    disabled={busyGuarantor === g.id || !(sigEmails[g.id] || '').trim()}
                    className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {busyGuarantor === g.id ? 'Adding…' : 'Add & invite'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {canManage && (
          <div className="mt-3 flex items-center gap-2">
            <input
              value={gName}
              onChange={(e) => setGName(e.target.value)}
              placeholder="Guarantor company name"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
            />
            <input
              value={gAbn}
              onChange={(e) => setGAbn(e.target.value)}
              placeholder="ABN"
              className="w-40 rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
            />
            <button
              onClick={handleAddGuarantor}
              disabled={addingGuarantor || !(gName.trim() || gAbn.trim())}
              className="shrink-0 rounded-md border border-primary px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
            >
              {addingGuarantor ? 'Adding…' : 'Add company'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
