import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, Button, Input } from '../../components/ui';
import { getErrorMessage, avatarColor, getInitials } from '../../lib/utils';
import type { User } from '../../types';

function Icon({ name, size = 14, strokeWidth = 1.75, className = '' }: { name: string; size?: number; strokeWidth?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevronLeft: <path d="m15 6-6 6 6 6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] || null}
    </svg>
  );
}

type ClientMode = 'existing' | 'new' | 'none';

interface FormValues {
  newName: string;
  newEmail: string;
  newPhone: string;
  noFirstName: string;
  noLastName: string;
  noEmail: string;
  noPhone: string;
  amount: string;
  notes: string;
  purposeId: string;
  commercialPurposeId: string;
  comBusinessName: string;
  comAbn: string;
}

const CONSUMER_PURPOSES = [
  { id: 42, label: 'Purchase' }, { id: 41, label: 'Refinance' }, { id: 20, label: 'Car' },
  { id: 21, label: 'Motorcycle' }, { id: 22, label: 'Caravan' }, { id: 23, label: 'Other Vehicle' },
  { id: 24, label: 'Personal Loan' },
];

const COMMERCIAL_PURPOSES = [
  { id: 1, label: 'Day-to-day Capital' }, { id: 3, label: 'Vehicles or Transport' },
  { id: 14, label: 'Machinery or Equipment' }, { id: 13, label: 'New Fit-out' },
  { id: 19, label: 'Staff Recruitment Costs' }, { id: 11, label: 'Expansion' },
  { id: 4, label: 'Renovation' }, { id: 15, label: 'Pay Domestic or International Suppliers' },
  { id: 18, label: 'Waiting for Invoices to be Paid' }, { id: 16, label: 'Property' },
  { id: 17, label: 'Development & Construction' }, { id: 9, label: 'Start a New Business' },
  { id: 10, label: 'Purchase Existing Business' }, { id: 8, label: 'Other' },
];

const LEND_LOAN_TYPES = [
  { value: 'equipment_finance', label: 'Equipment Finance', description: 'Finance equipment, machinery and vehicles', icon: '🏗️' },
  { value: 'business_loan', label: 'Business Loan', description: 'Working capital, growth or refinancing', icon: '💼' },
  { value: 'commercial_property', label: 'Commercial Property', description: 'Purchase or refinance commercial real estate', icon: '🏢' },
  { value: 'home_loan', label: 'Home Loan', description: 'Purchase or refinance residential property', icon: '🏠' },
];

export default function CreateApplication() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    defaultValues: { newName: '', newEmail: '', newPhone: '', noFirstName: '', noLastName: '', noEmail: '', noPhone: '', amount: '', notes: '', purposeId: '', commercialPurposeId: '', comBusinessName: '', comAbn: '' },
  });

  const [mode, setMode] = useState<ClientMode>('existing');

  // Existing client
  const [clients, setClients] = useState<User[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<User | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Application config (UI state, not form fields)
  const [lendEnabled, setLendEnabled] = useState(false);
  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);
  const [tab] = useState<'consumer' | 'commercial'>('consumer');

  useEffect(() => {
    api
      .get('/users')
      .then(({ data }) => setClients(data.filter((u: User) => u.role === 'client')))
      .catch(() => {})
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    api.get('/lend/config').then(({ data }) => setLendEnabled(data.enabled)).catch(() => {});
  }, []);

  const toggleLoanType = (type: string) => {
    setSelectedLoanTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredClients = clients
    .filter((c) => {
      const q = search.toLowerCase();
      return c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    })
    .slice(0, 8);

  const onSubmit = async (values: FormValues) => {
    if (mode === 'existing' && !selectedClient) {
      toast('Please select a client', 'error');
      return;
    }
    if (lendEnabled && selectedLoanTypes.length === 0) {
      toast('Please select at least one loan type', 'error');
      return;
    }
    try {
      if (mode === 'none') {
        const payload: Record<string, unknown> = {
          amount: parseFloat(values.amount) || 0,
          notes: values.notes || null,
          applicant_first_name: values.noFirstName.trim() || null,
          applicant_last_name: values.noLastName.trim() || null,
          applicant_email: values.noEmail.trim() || null,
          applicant_mobile: values.noPhone.trim() || null,
        };

        if (lendEnabled) {
          payload.loan_type = selectedLoanTypes[0] || 'equipment_finance';
        } else if (tab === 'consumer') {
          payload.loan_type = 'personal';
          if (values.purposeId) payload.loan_purpose_id = Number(values.purposeId);
        } else {
          payload.loan_type = 'business_loan';
          if (values.commercialPurposeId) payload.loan_purpose_id = Number(values.commercialPurposeId);
          if (values.comBusinessName.trim()) payload.business_name = values.comBusinessName.trim();
          if (values.comAbn.trim()) payload.business_abn = values.comAbn.trim();
        }

        const { data } = await api.post('/applications', payload);
        toast('Application created', 'success');
        navigate(`/admin/applications/${data.id}`);
        return;
      }

      let clientId: string;

      if (mode === 'new') {
        const { data: newUser } = await api.post('/invitations', {
          email: values.newEmail,
          full_name: values.newName,
          phone: values.newPhone || null,
        });
        clientId = newUser.id;
      } else {
        clientId = selectedClient!.id;
      }

      const payload: Record<string, unknown> = {
        client_id: clientId,
        amount: parseFloat(values.amount) || 0,
        notes: values.notes || null,
      };

      if (lendEnabled) {
        payload.loan_type = selectedLoanTypes[0] || 'equipment_finance';
      } else if (tab === 'consumer') {
        payload.loan_type = 'personal';
        if (values.purposeId) payload.loan_purpose_id = Number(values.purposeId);
      } else {
        payload.loan_type = 'business_loan';
        if (values.commercialPurposeId) payload.loan_purpose_id = Number(values.commercialPurposeId);
        if (values.comBusinessName.trim()) payload.business_name = values.comBusinessName.trim();
        if (values.comAbn.trim()) payload.business_abn = values.comAbn.trim();
      }

      const { data } = await api.post('/invitations/start-application', payload);

      toast('Application created', 'success');
      navigate(`/admin/applications/${data.application_id}`);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to create application'), 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-[660px]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/admin/applications">
          <Button variant="ghost" size="sm">
            <Icon name="chevronLeft" size={15} />
          </Button>
        </Link>
        <div>
          <h1 className="led-h-page">New Application</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Create a draft application and notify the client by email.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Client card */}
        <GlassCard className="!overflow-visible">
          <h2 className="text-[13px] font-semibold text-foreground mb-4">Client</h2>

          {/* Mode toggle */}
          <div className="led-segment mb-4 w-fit">
            <button
              type="button"
              className={mode === 'existing' ? 'led-active' : ''}
              onClick={() => { setMode('existing'); setSelectedClient(null); setSearch(''); }}
            >
              <Icon name="search" size={11} /> Existing client
            </button>
            <button
              type="button"
              className={mode === 'new' ? 'led-active' : ''}
              onClick={() => setMode('new')}
            >
              <Icon name="plus" size={11} /> New client
            </button>
            <button
              type="button"
              className={mode === 'none' ? 'led-active' : ''}
              onClick={() => setMode('none')}
            >
              No client yet
            </button>
          </div>

          {/* Existing client search */}
          {mode === 'existing' && (
            <div ref={dropdownRef} className="relative">
              {selectedClient ? (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-secondary">
                  <span
                    className="led-avatar led-avatar-sm"
                    style={{ background: avatarColor(selectedClient.full_name) }}
                  >
                    {getInitials(selectedClient.full_name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-foreground">{selectedClient.full_name}</div>
                    <div className="text-[12px] text-muted-foreground">{selectedClient.email}</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelectedClient(null); setSearch(''); }}
                  >
                    <Icon name="close" size={13} />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="led-search w-full">
                    <Icon name="search" size={13} />
                    <input
                      type="text"
                      placeholder="Search by name or email…"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                      onFocus={() => setDropdownOpen(true)}
                      className="w-full"
                      autoComplete="off"
                    />
                  </div>
                  {dropdownOpen && !clientsLoading && (
                    <div className="led-popover top-[calc(100%+4px)] left-0 right-0 z-30 max-h-[280px] overflow-y-auto">
                      {filteredClients.length === 0 ? (
                        <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                          {search ? `No clients matching "${search}"` : 'No clients yet — switch to New client to invite one'}
                        </div>
                      ) : filteredClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="led-popover-item min-h-[40px] px-2.5 py-1.5 items-center gap-2.5"
                          onClick={() => { setSelectedClient(c); setSearch(''); setDropdownOpen(false); }}
                        >
                          <span
                            className="led-avatar led-avatar-sm shrink-0"
                            style={{ background: avatarColor(c.full_name) }}
                          >
                            {getInitials(c.full_name)}
                          </span>
                          <div className="min-w-0 text-left">
                            <div className="text-[13px] font-medium text-foreground leading-snug">{c.full_name}</div>
                            <div className="text-[11.5px] text-muted-foreground leading-snug truncate">{c.email}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* New client fields */}
          {mode === 'new' && (
            <div className="space-y-3">
              <Input
                label="Full Name *"
                type="text"
                placeholder="Jane Smith"
                error={errors.newName?.message}
                {...register('newName', { required: mode === 'new' ? 'Required' : false })}
              />
              <Input
                label="Email *"
                type="email"
                placeholder="jane@example.com"
                error={errors.newEmail?.message}
                {...register('newEmail', {
                  required: mode === 'new' ? 'Required' : false,
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email' },
                })}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="0412 345 678"
                {...register('newPhone')}
              />
            </div>
          )}

          {/* No client — applicant info only */}
          {mode === 'none' && (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">
                Start the application now — you can link or invite a client later from the application page.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="First Name"
                  type="text"
                  placeholder="Jane"
                  {...register('noFirstName')}
                />
                <Input
                  label="Last Name"
                  type="text"
                  placeholder="Smith"
                  {...register('noLastName')}
                />
              </div>
              <Input
                label="Email"
                type="email"
                placeholder="jane@example.com"
                error={errors.noEmail?.message}
                {...register('noEmail', {
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email' },
                })}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="0412 345 678"
                {...register('noPhone')}
              />
            </div>
          )}
        </GlassCard>

        {/* Loan details card */}
        <GlassCard>
          <h2 className="text-[13px] font-semibold text-foreground mb-4">Loan Details</h2>



          {!lendEnabled && tab === 'consumer' && (
            <div className="mb-4">
              <label className="block text-[12.5px] font-medium text-muted-foreground mb-1.5">Purpose</label>
              <select className="led-input" {...register('purposeId')}>
                <option value="">Select purpose...</option>
                {CONSUMER_PURPOSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          )}

          {!lendEnabled && tab === 'commercial' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 mb-4">
                <div>
                  <label className="block text-[12.5px] font-medium text-muted-foreground mb-1.5">Business / Entity Name</label>
                  <input className="led-input" placeholder="Acme Pty Ltd" {...register('comBusinessName')} />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium text-muted-foreground mb-1.5">ACN / ABN</label>
                  <input className="led-input" placeholder="12 345 678 901" {...register('comAbn')} />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-[12.5px] font-medium text-muted-foreground mb-1.5">Purpose</label>
                <select className="led-input" {...register('commercialPurposeId')}>
                  <option value="">Select purpose...</option>
                  {COMMERCIAL_PURPOSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </>
          )}

          {lendEnabled && (
            <div className="mb-4">
              <label className="block text-[12.5px] font-medium text-muted-foreground mb-2">Loan Type(s)</label>
              <div className="space-y-2">
                {LEND_LOAN_TYPES.map(type => {
                  const active = selectedLoanTypes.includes(type.value);
                  return (
                    <button key={type.value} type="button" onClick={() => toggleLoanType(type.value)}
                      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border text-left transition-all ${active ? 'border-primary bg-primary/10' : 'border-border bg-secondary'}`}
                    >
                      <span className="text-[20px]">{type.icon}</span>
                      <div>
                        <div className={`text-[13.5px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{type.label}</div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{type.description}</div>
                      </div>
                      {active && <span className="ml-auto text-primary font-bold text-[18px]">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Amount */}
          <div className="mb-4">
            <Input
              label="Amount *"
              type="number"
              min="1"
              step="any"
              placeholder="50000"
              error={errors.amount?.message}
              {...register('amount', {
                required: 'Required',
                validate: v => parseFloat(v) > 0 || 'Must be greater than 0',
              })}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[12.5px] font-medium text-muted-foreground mb-1.5">Notes</label>
            <textarea
              className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-y min-h-[72px]"
              placeholder="Optional notes for the client…"
              rows={3}
              {...register('notes')}
            />
          </div>
        </GlassCard>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={() => navigate('/admin/applications')} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || (mode === 'existing' && !selectedClient)}
            loading={isSubmitting}
          >
            {!isSubmitting && <>Create Application <Icon name="chevronRight" size={14} /></>}
          </Button>
        </div>
      </form>
    </div>
  );
}
