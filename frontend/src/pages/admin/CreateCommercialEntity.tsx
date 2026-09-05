import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import TrustNoAbnDialog from '../../components/TrustNoAbnDialog';
import { Card, PageHeader, Button, Input, Select, EntitySearchResults } from '../../components/ui';
import { ENTITY_TYPES, TRUST_TYPES } from '../../lib/constants';
import { getErrorMessage } from '../../lib/utils';
import { useEntitySearch } from '../../hooks/useEntitySearch';
import type { EntitySearchResult, EntityType, Organization, TrustType } from '../../types';

const LBL = 'block text-[12px] font-medium text-muted-foreground mb-1';

// Commercial loan types (backend LoanType enum values treated as commercial).
const COMMERCIAL_TYPE_OPTIONS = [
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'commercial_property', label: 'Commercial Property' },
  { value: 'equipment_finance', label: 'Equipment Finance' },
] as const;

/**
 * Entity-first commercial create: the broker/admin creates the borrowing entity
 * (no inline applicant), then adds directors/guarantors on the review page —
 * each is emailed a magic-link to self-complete their own block.
 *
 * A trust borrower is created as an Organization first (so entity/trust type and
 * the no-ABN acknowledgement are recorded), then the application links back to
 * it by ABN, or by name when the trust has none.
 */
export default function CreateCommercialEntity() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [businessName, setBusinessName] = useState('');
  const [entityType, setEntityType] = useState<EntityType | ''>('');
  const [trustType, setTrustType] = useState<TrustType | ''>('');
  const [abn, setAbn] = useState('');
  const [loanType, setLoanType] = useState<string>('business_loan');
  const [amount, setAmount] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [numDirectors, setNumDirectors] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmingNoAbn, setConfirmingNoAbn] = useState(false);
  // The entity picked from the book, if any — the application links straight to
  // it rather than resolving a (possibly duplicate) company from the typed name.
  const [pickedEntityId, setPickedEntityId] = useState<string | null>(null);
  const [entityDismissedFor, setEntityDismissedFor] = useState('');

  const isTrust = entityType === 'trust';
  const entityMatches = useEntitySearch(businessName);
  const showEntityMatches =
    !pickedEntityId && businessName.trim() !== entityDismissedFor && businessName.trim().length >= 2;

  const useExistingEntity = (e: EntitySearchResult) => {
    setPickedEntityId(e.id);
    setBusinessName(e.name);
    setAbn(e.abn || '');
    if (e.entity_type) setEntityType(e.entity_type as EntityType);
    setTrustType((e.trust_type as TrustType) || '');
    setEntityDismissedFor(e.name.trim());
  };

  const create = async (noAbnConfirmed: boolean) => {
    setSubmitting(true);
    try {
      // Create/refresh the entity record first so the trust structure has
      // somewhere to live before the application exists.
      let org: Organization | null = null;
      // An entity chosen from the book is already recorded; re-creating it would
      // only risk a second row for the same company under a different spelling.
      if (entityType && !pickedEntityId) {
        const { data } = await api.post<Organization>('/organizations', {
          name: businessName.trim(),
          entity_type: entityType,
          trust_type: isTrust ? trustType || null : null,
          abn: abn.trim() || null,
          no_abn_confirmed: noAbnConfirmed,
        });
        org = data;
      }

      const { data: app } = await api.post('/applications', {
        loan_type: loanType,
        amount: parseFloat(amount),
        // The entity itself is the applicant — the directors are added as parties.
        applicant_type: 'company',
        business_name: org?.name || businessName.trim(),
        business_abn: abn.trim() || null,
        ...(termMonths.trim() && { loan_term_requested: parseInt(termMonths, 10) }),
        ...(numDirectors.trim() && { num_directors: parseInt(numDirectors, 10) }),
        ...(notes.trim() && { notes: notes.trim() }),
      });
      toast(
        isTrust
          ? 'Trust created — capture its structure on the entity, then add directors & guarantors'
          : 'Commercial entity created — now add directors & guarantors',
        'success',
      );
      navigate(`/admin/applications/${app.id}`);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to create entity'), 'error');
    } finally {
      setSubmitting(false);
      setConfirmingNoAbn(false);
    }
  };

  const handleSubmit = async () => {
    if (!businessName.trim()) { toast('Please enter the entity name', 'error'); return; }
    // A trust may legitimately have no ABN — every other structure must have one.
    if (!abn.trim() && !isTrust) { toast('ABN is required for a commercial entity', 'error'); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast('Please enter a valid loan amount', 'error');
      return;
    }
    if (isTrust && !abn.trim()) {
      setConfirmingNoAbn(true);
      return;
    }
    await create(false);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="New Commercial Entity"
        subtitle="Create the borrowing entity, then invite directors and guarantors to complete their own details."
      />

      <Card padding="lg" className="mt-4">
        <div className="space-y-5">
          <div className="relative">
            <Input
              label="Entity name"
              value={businessName}
              onChange={(e) => {
                setBusinessName(e.target.value);
                // Typing past the picked entity's name means they're after a
                // different one — stop claiming the link.
                setPickedEntityId(null);
              }}
              placeholder={isTrust ? 'e.g. Smith Family Trust' : 'e.g. Acme Pty Ltd'}
            />
            {showEntityMatches && (
              <EntitySearchResults
                matches={entityMatches.matches}
                loading={entityMatches.loading}
                searched={entityMatches.searched}
                onSelect={useExistingEntity}
                onDismiss={() => setEntityDismissedFor(businessName.trim())}
              />
            )}
            {pickedEntityId && (
              <p className="mt-1.5 text-[12px] text-success">
                Using your existing entity — its directors will be added to the application.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Entity type"
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value as EntityType | ''); setTrustType(''); }}
            >
              <option value="">Not specified</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>

            {isTrust && (
              <Select
                label="Trust type"
                value={trustType}
                onChange={(e) => setTrustType(e.target.value as TrustType | '')}
              >
                <option value="">Not specified</option>
                {TRUST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            )}
          </div>

          <Input
            label={isTrust ? 'ABN (optional for a trust)' : 'ABN'}
            value={abn}
            onChange={(e) => setAbn(e.target.value)}
            placeholder="11 digit ABN"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Loan type"
              value={loanType}
              onChange={(e) => setLoanType(e.target.value)}
            >
              {COMMERCIAL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>

            <Input
              label="Loan amount"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              suffix="AUD"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LBL}>Loan term (months)</label>
              <Input
                type="number"
                min="0"
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className={LBL}>Number of directors</label>
              <Input
                type="number"
                min="1"
                value={numDirectors}
                onChange={(e) => setNumDirectors(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <label className={LBL}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional context for this entity"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => navigate('/admin/applications')} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={submitting}>
              Create entity
            </Button>
          </div>
        </div>
      </Card>

      <TrustNoAbnDialog
        open={confirmingNoAbn}
        name={businessName}
        loading={submitting}
        onConfirm={() => create(true)}
        onCancel={() => setConfirmingNoAbn(false)}
      />
    </div>
  );
}
