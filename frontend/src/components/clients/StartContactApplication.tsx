import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, Card, Input } from '../ui';
import { loanTypeOptions } from '../../lib/constants';
import { getErrorMessage } from '../../lib/utils';

export default function StartContactApplication({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loanType, setLoanType] = useState('personal');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  return <Card>
    <h3 className="font-semibold mb-2">Start an application</h3>
    <p className="text-sm text-muted-foreground mb-4">Create a draft for this person. You can invite them to complete it from the application.</p>
    <form className="flex flex-wrap items-end gap-4" onSubmit={async event => {
      event.preventDefault(); setBusy(true);
      try {
        const { data } = await api.post(`/contacts/${contactId}/pipeline`, { loan_type: loanType, amount: Number(amount) });
        navigate(`/admin/applications/${data.id}`);
      } catch (error) { toast(getErrorMessage(error, 'Could not start application'), 'error'); }
      finally { setBusy(false); }
    }}>
      <label className="text-sm">Loan type<select className="block rounded-lg border border-border bg-background px-3 py-2 mt-1" value={loanType} onChange={e => setLoanType(e.target.value)}>{loanTypeOptions().map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      <Input label="Amount" type="number" min="0" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
      <Button type="submit" loading={busy}>Create draft</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
    </form>
  </Card>;
}
