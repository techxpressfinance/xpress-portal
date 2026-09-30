import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card } from '../ui';
import { formatDate } from '../../lib/utils';
import { LOAN_TYPE_LABELS } from '../../lib/constants';
import type { ContactApplication, ContactDetail, LendingHistoryEntry } from '../../types';

type Props = {
  contact: ContactDetail;
  onAdd: () => void;
  onNotes: () => void;
  onEditLoan: (entry: LendingHistoryEntry) => void;
  onDeleteLoan: (id: string) => void;
  onEditApplication: (app: ContactApplication) => void;
  deletingId: string | null;
};
const money = (amount: number) => `$${amount.toLocaleString('en-AU')}`;
const selectClass = 'rounded-lg border border-border bg-background px-3 py-2 text-sm';

export default function ContactLendingHistory({ contact, onAdd, onNotes, onEditLoan, onDeleteLoan, onEditApplication, deletingId }: Props) {
  const navigate = useNavigate();
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const rows = useMemo(() => [
    ...contact.applications.map(app => ({
      key: `app:${app.id}`, date: app.settled_at || app.created_at, source: app.source,
      sourceLabel: app.source === 'settlement' ? 'Retained settlement' : 'Portal application',
      title: LOAN_TYPE_LABELS[app.loan_type] || app.loan_type, lender: app.lender_name,
      amount: app.amount, status: app.status as string, roles: app.roles, application: app, loan: null,
    })),
    ...contact.lending_history.map(loan => ({
      key: `loan:${loan.id}`, date: loan.start_date, source: 'external', sourceLabel: 'External loan',
      title: loan.identifier || 'Loan on record', lender: loan.lender_name, amount: loan.amount,
      status: 'recorded', roles: [loan.contact_id === contact.id ? 'Borrower' : 'Guarantor'], application: null, loan,
    })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [contact]);
  const roles = [...new Set(rows.flatMap(row => row.roles))].sort();
  const statuses = [...new Set(rows.map(row => row.status))].sort();
  const filtered = rows.filter(row => (source === 'all' || row.source === source) && (status === 'all' || row.status === status) && (role === 'all' || row.roles.includes(role)));
  return <Card>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div><h3 className="text-lg font-semibold">Lending history <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></h3><p className="text-sm text-muted-foreground mt-1">Applications, retained settlements, and external loans, with this person's role.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={onNotes}>Notes history</Button><Button size="sm" onClick={onAdd}>Add historical loan</Button></div>
    </div>
    <div className="flex flex-wrap gap-3 mb-4">
      <select aria-label="History source" className={selectClass} value={source} onChange={e => setSource(e.target.value)}><option value="all">All sources</option><option value="application">Portal applications</option><option value="settlement">Retained settlements</option><option value="external">External loans</option></select>
      <select aria-label="History status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s === 'recorded' ? 'External: status not recorded' : s.replace(/_/g, ' ')}</option>)}</select>
      <select aria-label="Role in loan" className={selectClass} value={role} onChange={e => setRole(e.target.value)}><option value="all">All roles</option>{roles.map(r => <option key={r}>{r}</option>)}</select>
      <span className="self-center text-sm text-muted-foreground">{filtered.length} records</span>
    </div>
    {!filtered.length ? <p className="py-8 text-sm text-muted-foreground text-center">{rows.length ? 'No records match these filters.' : 'No lending history yet. Start an application or add a historical loan.'}</p> : <div className="overflow-x-auto">
      <table className="w-full text-sm text-left min-w-[760px]">
        <thead><tr className="border-b border-border text-muted-foreground">{['Loan / lender', 'Amount', 'Role', 'Status', 'Date', 'Actions'].map(label => <th key={label} className="pb-3 pr-4 font-medium">{label}</th>)}</tr></thead>
        <tbody>{filtered.map(row => {
          // Settled applications open on a click anywhere in the row; the row's
          // own buttons and links keep their behaviour.
          const openApp = row.status === 'settled' && row.application?.can_open ? row.application : null;
          return <tr key={row.key}
            className={`border-b border-border/50 align-top${openApp ? ' cursor-pointer hover:bg-secondary/30 transition-colors' : ''}`}
            onClick={openApp ? e => { if (!(e.target as HTMLElement).closest('a, button')) navigate(`/admin/applications/${openApp.id}`); } : undefined}>
          <td className="py-4 pr-4"><p className="font-medium">{row.lender || row.title}</p><p className="text-xs text-muted-foreground mt-1">{row.lender ? `${row.title} · ` : ''}{row.sourceLabel}</p>
            {row.loan && <div className="text-xs text-muted-foreground mt-2 space-y-1">
              {row.loan.repayment_amount != null && <p>Repayment: {money(row.loan.repayment_amount)} {row.loan.repayment_frequency || ''}</p>}
              {row.loan.balloon != null && <p>Balloon: {money(row.loan.balloon)}</p>}
              {row.loan.other_broker_name && <p>Broker: {row.loan.other_broker_name}</p>}
              {row.loan.guaranteed_by_name && <p>Guaranteed by: {row.loan.guaranteed_by_name}</p>}
              {row.loan.notes && <p className="whitespace-pre-wrap max-w-xs">{row.loan.notes}</p>}
            </div>}
            {row.application?.business_name && <p className="text-xs text-muted-foreground mt-1">{row.application.business_name}</p>}
          </td>
          <td className="py-4 pr-4 whitespace-nowrap">{money(row.amount)}</td><td className="py-4 pr-4">{row.roles.join(', ')}</td>
          <td className="py-4 pr-4">{row.status === 'recorded' ? <span className="text-muted-foreground">Not recorded</span> : <Badge value={row.status} />}</td>
          <td className="py-4 pr-4 whitespace-nowrap">{row.date ? formatDate(row.date) : 'Not recorded'}<p className="text-xs text-muted-foreground">{row.loan ? 'Started' : row.application?.settled_at ? 'Settled' : row.source === 'settlement' ? 'Snapshot saved' : 'Created'}</p></td>
          <td className="py-4"><div className="flex gap-1">
            {row.loan && row.loan.contact_id === contact.id && <><Button variant="ghost" size="sm" onClick={() => onEditLoan(row.loan!)}>Edit</Button><Button variant="ghost" size="sm" loading={deletingId === row.loan.id} onClick={() => onDeleteLoan(row.loan!.id)}>Delete</Button></>}
            {row.loan && row.loan.contact_id !== contact.id && <Link className="text-primary hover:underline" to={`/admin/contacts/${row.loan.contact_id}`}>Borrower profile</Link>}
            {row.application?.can_open && <><Button variant="ghost" size="sm" onClick={() => onEditApplication(row.application!)}>Edit</Button><Link className="text-primary hover:underline self-center" to={`/admin/applications/${row.application.id}`}>Review</Link>
              {/* Start another loan for this client — personal and company details carry over. */}
              <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/applications/new?cloneFrom=${row.application!.id}`)}>Clone</Button></>}
            {row.source === 'settlement' && <span className="text-xs text-muted-foreground">Original application unavailable</span>}
          </div></td>
        </tr>;
        })}</tbody>
      </table>
    </div>}
  </Card>;
}
