import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Input, Select } from '../../components/ui';
import { getErrorMessage } from '../../lib/utils';

const LBL = 'block text-[12px] font-medium text-muted-foreground mb-1';

// Commercial loan types (backend LoanType enum values treated as commercial).
const COMMERCIAL_TYPE_OPTIONS = [
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'commercial_property', label: 'Commercial Property' },
  { value: 'equipment_finance', label: 'Equipment Finance' },
] as const;

/**
 * Entity-first commercial create: the broker/admin creates the company entity
 * (no inline applicant), then adds directors/guarantors on the review page —
 * each is emailed a magic-link to self-complete their own block.
 */
export default function CreateCommercialEntity() {
  const navigate = useNavigate();
  const toast = useToast();

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [loanType, setLoanType] = useState<string>('business_loan');
  const [amount, setAmount] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [numDirectors, setNumDirectors] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!businessName.trim()) { toast('Please enter the business name', 'error'); return; }
    if (!abn.trim()) { toast('ABN is required for a commercial entity', 'error'); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast('Please enter a valid loan amount', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { data: app } = await api.post('/applications', {
        loan_type: loanType,
        amount: parseFloat(amount),
        business_name: businessName.trim(),
        business_abn: abn.trim(),
        ...(termMonths.trim() && { loan_term_requested: parseInt(termMonths, 10) }),
        ...(numDirectors.trim() && { num_directors: parseInt(numDirectors, 10) }),
        ...(notes.trim() && { notes: notes.trim() }),
      });
      toast('Commercial entity created — now add directors & guarantors', 'success');
      navigate(`/admin/applications/${app.id}`);
    } catch (err) {
      toast(getErrorMessage(err) || 'Failed to create entity', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="New Commercial Entity"
        subtitle="Create the company, then invite directors and guarantors to complete their own details."
      />

      <GlassCard padding="lg" className="mt-4">
        <div className="space-y-5">
          <Input
            label="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Acme Pty Ltd"
          />

          <Input
            label="ABN"
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
      </GlassCard>
    </div>
  );
}
