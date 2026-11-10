import { useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import { CATEGORY_STYLE } from '../../lib/ledger';
import type { LedgerBroker, LedgerCategory, LedgerDealRow } from '../../types';
import LedgerModal from './LedgerModal';

/** Start a ledger-only deal — one with no portal application behind it
 *  (history, or business written outside the portal). The figures and payees
 *  are filled in the deal editor that opens next. */
export default function LedgerNewDealModal({ brokers, onClose, onCreated }: {
  brokers: LedgerBroker[];
  onClose: () => void;
  onCreated: (row: LedgerDealRow) => void;
}) {
  const { toast } = useToast();
  const [settledOn, setSettledOn] = useState(new Date().toISOString().slice(0, 10));
  const [customer, setCustomer] = useState('');
  const [entity, setEntity] = useState('');
  const [category, setCategory] = useState<LedgerCategory | ''>('asset_finance');
  const [brokerId, setBrokerId] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!customer.trim() || !settledOn) {
      toast('Enter the customer and the settled date', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post<LedgerDealRow>('/ledger/deals', {
        settled_on: settledOn,
        customer_name: customer.trim(),
        entity_name: entity.trim() || null,
        category: category || null,
        broker_id: brokerId || null,
      });
      onCreated(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add the deal'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'led-input !h-9 w-full text-[13px]';
  const labelCls = 'mb-1 block text-[12px] font-medium text-[var(--led-ink-2)]';

  return (
    <LedgerModal
      title="Add a ledger-only deal"
      subtitle="For a deal with no application in the portal."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={create} loading={saving}>Add and fill in figures</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Settled on</span>
          <input type="date" className={inputCls} value={settledOn} onChange={(e) => setSettledOn(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Kind of deal</span>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as LedgerCategory | '')}>
            <option value="">—</option>
            {(Object.keys(CATEGORY_STYLE) as LedgerCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_STYLE[k].label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Customer</span>
          <input className={inputCls} value={customer} autoFocus onChange={(e) => setCustomer(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Entity (business)</span>
          <input className={inputCls} value={entity} onChange={(e) => setEntity(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Broker</span>
          <select className={inputCls} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
            <option value="">—</option>
            {brokers.map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
          </select>
        </label>
      </div>
    </LedgerModal>
  );
}
