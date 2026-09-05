import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { getErrorMessage } from '../lib/utils';
import { CopyButton } from './ui/CopyButton';
import type { CompanyDirectorCandidate, LoanApplication, LoanApplicant } from '../types';

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

const candidateName = (c: CompanyDirectorCandidate) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed contact';

/**
 * Pulls a company's known directors onto the application in one go.
 *
 * The contact book already holds these people — retyping them (and their email,
 * and their address) is the step this removes. Contacts without an email are
 * still offered: they join the roster uninvited so the roster is honest about
 * who is missing, and the broker sends their invite once an address turns up.
 */
function CompanyDirectorPicker({
  applicationId,
  companyName,
  guarantorId,
  onAdded,
}: {
  applicationId: string;
  companyName: string;
  guarantorId?: string;
  onAdded: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<CompanyDirectorCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<CompanyDirectorCandidate[]>(`/applications/${applicationId}/company-directors`, {
        params: guarantorId ? { guarantor_id: guarantorId } : undefined,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setCandidates(data);
        setSelected(new Set());
      })
      .catch((err) => {
        if (!cancelled) toast(getErrorMessage(err, 'Failed to load the company’s directors'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, applicationId, guarantorId, toast]);

  const toggle = (contactId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const { data } = await api.post<LoanApplicant[]>(
        `/applications/${applicationId}/directors/from-company`,
        {
          contact_ids: [...selected],
          ...(guarantorId ? { guarantor_id: guarantorId } : {}),
        },
      );
      const invited = data.filter((d) => d.invite_sent_at).length;
      setOpen(false);
      await onAdded();
      toast(
        invited === data.length
          ? `Added ${data.length} ${data.length === 1 ? 'director' : 'directors'} and sent their invites`
          : `Added ${data.length}, invited ${invited} — the rest need an email address`,
        'success',
      );
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add directors'), 'error');
    } finally {
      setAdding(false);
    }
  };

  const available = candidates.filter((c) => !c.already_added);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted/50"
      >
        {open ? 'Close' : `Add from ${companyName}`}
      </button>

      {open && (
        <div className="mt-2 rounded-md border border-border p-3">
          {loading && <p className="text-[12px] text-muted-foreground">Loading…</p>}

          {!loading && candidates.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              No directors on file for this company yet. Link them as contacts on the company record,
              or add them by email above.
            </p>
          )}

          {!loading && candidates.length > 0 && (
            <>
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <label
                    key={c.contact_id}
                    className={`flex items-center gap-2 text-[13px] ${c.already_added ? 'text-muted-foreground' : 'text-foreground cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      disabled={c.already_added}
                      checked={c.already_added || selected.has(c.contact_id)}
                      onChange={() => toggle(c.contact_id)}
                    />
                    <span className="font-medium">{candidateName(c)}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {c.link_role || 'director'}
                      {c.already_added
                        ? ' · already added'
                        : c.email
                          ? ` · ${c.email}`
                          : ' · no email — added without an invite'}
                    </span>
                  </label>
                ))}
              </div>

              <button
                onClick={handleAdd}
                disabled={adding || selected.size === 0}
                className="mt-3 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {adding ? 'Adding…' : `Add selected${selected.size ? ` (${selected.size})` : ''}`}
              </button>
              {available.length === 0 && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Everyone on file for this company is already on the application.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const partyStatus = (d: LoanApplicant) => {
  if (d.completed_at) return d.signed_at ? 'Signed' : 'Completed, unsigned';
  if (d.invite_sent_at) return 'Invite sent';
  // Pulled from the contact book with no address on file — on the roster, but
  // nothing has gone out to them yet.
  return 'Not invited — no email';
};

export default function DirectorsSection({ application, onChange, canManage = false, canReconcile = false }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [newDirectorEmail, setNewDirectorEmail] = useState('');
  const [newDirectorRole, setNewDirectorRole] = useState('director');
  const [addingDirector, setAddingDirector] = useState(false);
  const [directorEmailError, setDirectorEmailError] = useState('');
  const [reconciling, setReconciling] = useState(false);

  // Corporate guarantor form
  const [gName, setGName] = useState('');
  const [gAbn, setGAbn] = useState('');
  const [addingGuarantor, setAddingGuarantor] = useState(false);
  const [guarantorError, setGuarantorError] = useState('');
  // Per-guarantor signatory email input, field error + in-flight id
  const [sigEmails, setSigEmails] = useState<Record<string, string>>({});
  const [sigErrors, setSigErrors] = useState<Record<string, string>>({});
  const [busyGuarantor, setBusyGuarantor] = useState<string | null>(null);
  // A party pulled from the contact book with no email: which row's inline
  // "send invite" form is open, and the address being typed into it.
  const [invitingPartyId, setInvitingPartyId] = useState<string | null>(null);
  const [partyEmail, setPartyEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  const handleAddDirector = useCallback(async () => {
    const email = newDirectorEmail.trim();
    if (!email) {
      setDirectorEmailError('An email is required — the director/guarantor is invited to complete their own details.');
      return;
    }
    setDirectorEmailError('');
    setAddingDirector(true);
    try {
      await api.post(`/applications/${application.id}/directors`, {
        role: newDirectorRole,
        invite_email: email,
      });
      setNewDirectorEmail('');
      setNewDirectorRole('director');
      await onChange();
      toast(`Invite sent to ${email}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add director'), 'error');
    } finally {
      setAddingDirector(false);
    }
  }, [application.id, newDirectorEmail, newDirectorRole, onChange, toast]);

  const handleSendPartyInvite = useCallback(async (applicantId: string) => {
    const email = partyEmail.trim();
    if (!email) return;
    setSendingInvite(true);
    try {
      await api.post(`/applications/${application.id}/directors/${applicantId}/invite`, {
        invite_email: email,
      });
      setInvitingPartyId(null);
      setPartyEmail('');
      await onChange();
      toast(`Invite sent to ${email}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to send the invite'), 'error');
    } finally {
      setSendingInvite(false);
    }
  }, [application.id, partyEmail, onChange, toast]);

  const handleRemoveDirector = useCallback(async (applicantId: string) => {
    if (!(await confirm({
      title: 'Remove this person from the application?',
      confirmText: 'Remove',
      variant: 'danger',
    }))) return;
    try {
      await api.delete(`/applications/${application.id}/directors/${applicantId}`);
      await onChange();
      toast('Removed from application', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove'), 'error');
    }
  }, [application.id, onChange, toast, confirm]);

  const handleReconcile = useCallback(async () => {
    setReconciling(true);
    try {
      await api.post(`/applications/${application.id}/reconcile`, {});
      await onChange();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to resolve'), 'error');
    } finally {
      setReconciling(false);
    }
  }, [application.id, onChange, toast]);

  const handleAddGuarantor = useCallback(async () => {
    const name = gName.trim();
    const abn = gAbn.trim();
    if (!name && !abn) {
      setGuarantorError('Enter the guarantor company name or ABN.');
      return;
    }
    setGuarantorError('');
    setAddingGuarantor(true);
    try {
      await api.post(`/applications/${application.id}/guarantors`, {
        ...(name ? { business_name: name } : {}),
        ...(abn ? { business_abn: abn } : {}),
      });
      setGName('');
      setGAbn('');
      await onChange();
      toast('Corporate guarantor added', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add corporate guarantor'), 'error');
    } finally {
      setAddingGuarantor(false);
    }
  }, [application.id, gName, gAbn, onChange, toast]);

  const handleRemoveGuarantor = useCallback(async (guarantorId: string) => {
    if (!(await confirm({
      title: 'Remove this corporate guarantor?',
      message: 'Its signatories are removed with it.',
      confirmText: 'Remove',
      variant: 'danger',
    }))) return;
    try {
      await api.delete(`/applications/${application.id}/guarantors/${guarantorId}`);
      await onChange();
      toast('Corporate guarantor removed', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove corporate guarantor'), 'error');
    }
  }, [application.id, onChange, toast, confirm]);

  const handleAddSignatory = useCallback(async (guarantorId: string) => {
    const email = (sigEmails[guarantorId] || '').trim();
    if (!email) {
      setSigErrors((prev) => ({ ...prev, [guarantorId]: 'An email is required — the director is invited to sign the guarantee.' }));
      return;
    }
    setSigErrors((prev) => ({ ...prev, [guarantorId]: '' }));
    setBusyGuarantor(guarantorId);
    try {
      await api.post(`/applications/${application.id}/guarantors/${guarantorId}/signatories`, {
        invite_email: email,
      });
      setSigEmails((prev) => ({ ...prev, [guarantorId]: '' }));
      await onChange();
      toast(`Invite sent to ${email}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add signatory'), 'error');
    } finally {
      setBusyGuarantor(null);
    }
  }, [application.id, sigEmails, onChange, toast]);

  // A company applicant has directors whatever it is borrowing for — a business
  // financing a ute sits on a `vehicle` loan, not a commercial one.
  if (!COMMERCIAL_TYPES.includes(application.loan_type) && application.applicant_type !== 'company') return null;

  const directors = application.additional_applicants || [];
  const guarantors = application.corporate_guarantors || [];

  // Legacy applicant-first apps carry an inline primary; entity-first apps don't.
  // Only show the separate primary card when there is real inline data.
  const hasInlinePrimary = Boolean(application.applicant_first_name || application.applicant_last_name);
  const partyCount = (hasInlinePrimary ? 1 : 0) + directors.length;
  const hasAnyParty = partyCount > 0 || guarantors.length > 0;

  const partyRow = (d: LoanApplicant) => (
    <div key={d.id} className="rounded-md border border-border px-3 py-2">
      <div className="flex items-center justify-between">
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
          {canManage && !d.invite_sent_at && (
            <button
              onClick={() => {
                setInvitingPartyId(invitingPartyId === d.id ? null : d.id);
                setPartyEmail(d.applicant_email || '');
              }}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              {invitingPartyId === d.id ? 'Cancel' : 'Add email & invite'}
            </button>
          )}
          {canManage && (
            <button onClick={() => handleRemoveDirector(d.id)} className="text-[12px] text-destructive hover:underline">
              Remove
            </button>
          )}
        </div>
      </div>

      {canManage && invitingPartyId === d.id && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="email"
            value={partyEmail}
            onChange={(e) => setPartyEmail(e.target.value)}
            placeholder="Email to send their invite to"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
          />
          <button
            onClick={() => handleSendPartyInvite(d.id)}
            disabled={sendingInvite || !partyEmail.trim()}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {sendingInvite ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      )}
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
        <div className="mt-3">
          <div className="flex items-center gap-2">
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
              onChange={(e) => {
                setNewDirectorEmail(e.target.value);
                if (directorEmailError) setDirectorEmailError('');
              }}
              placeholder="Email (required, sends invite)"
              aria-invalid={Boolean(directorEmailError)}
              className={`flex-1 rounded-md border bg-background px-3 py-1.5 text-[13px] ${directorEmailError ? 'border-destructive' : 'border-border'}`}
            />
            <button
              onClick={handleAddDirector}
              disabled={addingDirector || !newDirectorEmail.trim()}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {addingDirector ? 'Adding…' : 'Add & invite'}
            </button>
          </div>
          {directorEmailError && <p className="mt-1 text-[12px] text-destructive">{directorEmailError}</p>}
          {application.business_organization_id && (
            <CompanyDirectorPicker
              applicationId={application.id}
              companyName={application.business_name || 'the company'}
              onAdded={onChange}
            />
          )}
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
                <div className="mt-2 pl-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={sigEmails[g.id] || ''}
                      onChange={(e) => {
                        setSigEmails((prev) => ({ ...prev, [g.id]: e.target.value }));
                        if (sigErrors[g.id]) setSigErrors((prev) => ({ ...prev, [g.id]: '' }));
                      }}
                      placeholder="Director email (required, sends invite)"
                      aria-invalid={Boolean(sigErrors[g.id])}
                      className={`flex-1 rounded-md border bg-background px-3 py-1.5 text-[13px] ${sigErrors[g.id] ? 'border-destructive' : 'border-border'}`}
                    />
                    <button
                      onClick={() => handleAddSignatory(g.id)}
                      disabled={busyGuarantor === g.id || !(sigEmails[g.id] || '').trim()}
                      className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {busyGuarantor === g.id ? 'Adding…' : 'Add & invite'}
                    </button>
                  </div>
                  {sigErrors[g.id] && <p className="mt-1 text-[12px] text-destructive">{sigErrors[g.id]}</p>}
                  <CompanyDirectorPicker
                    applicationId={application.id}
                    companyName={g.organization_name || 'the company'}
                    guarantorId={g.id}
                    onAdded={onChange}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {canManage && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                value={gName}
                onChange={(e) => {
                  setGName(e.target.value);
                  if (guarantorError) setGuarantorError('');
                }}
                placeholder="Guarantor company name"
                aria-invalid={Boolean(guarantorError)}
                className={`flex-1 rounded-md border bg-background px-3 py-1.5 text-[13px] ${guarantorError ? 'border-destructive' : 'border-border'}`}
              />
              <input
                value={gAbn}
                onChange={(e) => {
                  setGAbn(e.target.value);
                  if (guarantorError) setGuarantorError('');
                }}
                placeholder="ABN"
                aria-invalid={Boolean(guarantorError)}
                className={`w-40 rounded-md border bg-background px-3 py-1.5 text-[13px] ${guarantorError ? 'border-destructive' : 'border-border'}`}
              />
              <button
                onClick={handleAddGuarantor}
                disabled={addingGuarantor || !(gName.trim() || gAbn.trim())}
                className="shrink-0 rounded-md border border-primary px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
              >
                {addingGuarantor ? 'Adding…' : 'Add company'}
              </button>
            </div>
            {guarantorError && <p className="mt-1 text-[12px] text-destructive">{guarantorError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
