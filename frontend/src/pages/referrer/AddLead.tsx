import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';
import { getErrorMessage } from '../../lib/utils';

const LABEL_CLS = 'block text-[13px] font-medium text-muted-foreground mb-2';

const LOAN_TYPES = [
  { value: 'home_loan', label: 'Home Loan', icon: '🏠', description: 'Purchase or refinance residential property' },
  { value: 'vehicle', label: 'Car / Vehicle', icon: '🚗', description: 'Finance a car, truck, or other vehicle' },
  { value: 'personal', label: 'Personal Loan', icon: '💳', description: 'Personal finance for any purpose' },
  { value: 'business_loan', label: 'Business Loan', icon: '💼', description: 'Working capital, growth or refinancing' },
  { value: 'equipment_finance', label: 'Equipment Finance', icon: '🏗️', description: 'Finance equipment and machinery' },
  { value: 'commercial_property', label: 'Commercial Property', icon: '🏢', description: 'Purchase or refinance commercial real estate' },
];

interface PrevClient {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile?: string;
}

interface AddLeadProps {
  basePath?: string;
  title?: string;
  submitLabel?: string;
  skipEngagement?: boolean;
}

export default function AddLead({ basePath = '/referrer/applications', title = 'Add Lead', submitLabel, skipEngagement = false }: AddLeadProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  // Client
  const [clientMode, setClientMode] = useState<'new' | 'existing'>('new');
  const [prevClients, setPrevClients] = useState<PrevClient[]>([]);
  const [prevClientsLoading, setPrevClientsLoading] = useState(false);
  const [prevClientSearch, setPrevClientSearch] = useState('');
  const [selectedPrevClient, setSelectedPrevClient] = useState<PrevClient | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');

  // Engagement
  const [engagementModel, setEngagementModel] = useState<'direct_engagement' | 'self_managed' | ''>('');
  const [engagementError, setEngagementError] = useState('');

  // Application
  const [loanType, setLoanType] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (clientMode !== 'existing') return;
    setPrevClientsLoading(true);
    api.get('/referrer/clients')
      .then(({ data }) => {
        setPrevClients((data as Array<{ first_name: string; last_name: string; email: string; mobile: string }>).map(c => ({
          name: [c.first_name, c.last_name].filter(Boolean).join(' '),
          firstName: c.first_name,
          lastName: c.last_name,
          email: c.email,
          mobile: c.mobile || undefined,
        })));
      })
      .catch(() => {})
      .finally(() => setPrevClientsLoading(false));
  }, [clientMode]);

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setFiles(prev => [...prev, file]);
  };

  const handleSubmit = async () => {
    if (!skipEngagement && !engagementModel) { setEngagementError('Please select who will engage with the client'); return; }
    if (!firstName.trim() || !lastName.trim()) { toast("Please enter the client's name", 'error'); return; }
    if (!email.trim()) { toast("Please enter the client's email", 'error'); return; }
    if (!loanType) { toast('Please select a loan type', 'error'); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { toast('Please enter a valid amount', 'error'); return; }

    setSubmitting(true);
    try {
      // Create draft
      const { data: app } = await api.post('/applications', {
        loan_type: loanType,
        amount: parseFloat(amount),
        ...(engagementModel && { client_engagement_model: engagementModel }),
        applicant_first_name: firstName.trim(),
        applicant_last_name: lastName.trim(),
        applicant_email: email.trim(),
        applicant_mobile: mobile.trim() || null,
        notes: notes.trim() || null,
        status: 'application_received',
      });

      // Upload files
      await Promise.allSettled(
        files.map(file => {
          const form = new FormData();
          form.append('file', file);
          form.append('doc_type', 'other');
          return api.post(`/documents/upload/${app.id}`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        })
      );

      setDone(true);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to submit lead'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setClientMode('new'); setSelectedPrevClient(null); setPrevClientSearch('');
    setFirstName(''); setLastName(''); setEmail(''); setMobile('');
    setEngagementModel(''); setEngagementError('');
    setLoanType(''); setAmount(''); setNotes(''); setFiles([]);
    setDone(false);
  };

  // ── Success ───────────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <GlassCard>
          <div className="text-center space-y-5 py-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <svg className="h-7 w-7 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-[18px] font-semibold text-foreground">Lead submitted!</p>
              <p className="text-[14px] text-muted-foreground mt-1.5">
                {engagementModel === 'direct_engagement'
                  ? `An email has been sent to ${firstName} to complete their application. Our team will follow up with them directly.`
                  : `Your broker will review and follow up with ${firstName}.`}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate(basePath)}>View Applications</Button>
              <Button variant="secondary" onClick={reset}>Add Another</Button>
            </div>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── Single page form ──────────────────────────────────────────────────────

  const filtered = prevClients.filter(c => {
    const q = prevClientSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={title} subtitle="Fill in the details and submit — your broker handles the rest" />

      {/* Client */}
      <GlassCard className="space-y-4">
        <p className="text-[15px] font-semibold text-foreground">Client</p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => { setClientMode('new'); setSelectedPrevClient(null); }}
            className={`flex-1 rounded-xl border py-2 text-[13px] font-medium transition-colors ${clientMode === 'new' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}
          >New client</button>
          <button type="button"
            onClick={() => setClientMode('existing')}
            className={`flex-1 rounded-xl border py-2 text-[13px] font-medium transition-colors ${clientMode === 'existing' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}
          >Previous client</button>
        </div>

        {clientMode === 'existing' && (
          <div className="space-y-2">
            <Input placeholder="Search by name or email..." value={prevClientSearch} onChange={e => setPrevClientSearch(e.target.value)} />
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {prevClientsLoading && <p className="text-[13px] text-muted-foreground text-center py-3">Loading...</p>}
              {!prevClientsLoading && filtered.length === 0 && (
                <p className="text-[13px] text-muted-foreground text-center py-3">No previous clients found</p>
              )}
              {filtered.map((c, i) => (
                <button key={i} type="button"
                  onClick={() => { setSelectedPrevClient(c); setFirstName(c.firstName); setLastName(c.lastName); setEmail(c.email); setMobile(c.mobile ?? ''); }}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${selectedPrevClient?.email === c.email ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                >
                  <p className="text-[14px] font-medium text-foreground">{c.name}</p>
                  <p className="text-[12px] text-muted-foreground">{c.email}{c.mobile ? ` · ${c.mobile}` : ''}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>First Name *</label>
            <Input placeholder="John" value={firstName} onChange={e => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Last Name *</label>
            <Input placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Email *</label>
            <Input type="email" placeholder="john@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Mobile <span className="font-normal">(optional)</span></label>
            <Input type="tel" placeholder="04XX XXX XXX" value={mobile} onChange={e => setMobile(e.target.value)} />
          </div>
        </div>
      </GlassCard>

      {/* Engagement */}
      {!skipEngagement && <GlassCard className="space-y-3">
        <p className="text-[15px] font-semibold text-foreground">Who will engage with the client?</p>
        <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${engagementModel === 'direct_engagement' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
          <input type="radio" name="engagement" value="direct_engagement" checked={engagementModel === 'direct_engagement'} onChange={() => { setEngagementModel('direct_engagement'); setEngagementError(''); }} className="mt-0.5 accent-primary shrink-0" />
          <div>
            <p className="text-[14px] font-medium text-foreground">Xpress Finance will engage with the client</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">Our team will contact and work with the client directly.</p>
          </div>
        </label>
        <label className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${engagementModel === 'self_managed' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
          <input type="radio" name="engagement" value="self_managed" checked={engagementModel === 'self_managed'} onChange={() => { setEngagementModel('self_managed'); setEngagementError(''); }} className="mt-0.5 accent-primary shrink-0" />
          <div>
            <p className="text-[14px] font-medium text-foreground">I will engage with the client</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">You'll fill in details on the client's behalf.</p>
          </div>
        </label>
        {engagementError && <p className="text-[12px] text-destructive">{engagementError}</p>}
      </GlassCard>}

      {/* Loan type */}
      <GlassCard className="space-y-3">
        <p className="text-[15px] font-semibold text-foreground">What does the client need?</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LOAN_TYPES.map(lt => (
            <button key={lt.value} type="button" onClick={() => setLoanType(lt.value)}
              className={`rounded-xl border p-3 text-left transition-all ${loanType === lt.value ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/30 hover:bg-secondary/50'}`}
            >
              <span className="text-xl leading-none">{lt.icon}</span>
              <p className="text-[13px] font-medium text-foreground mt-2">{lt.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{lt.description}</p>
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Amount + Notes */}
      <GlassCard className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Approximate Amount *</label>
          <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-strong)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
            <span className="flex shrink-0 items-center border-r border-[var(--led-line-strong)] bg-secondary/60 px-3.5 text-[13px] font-medium text-muted-foreground">AUD $</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="flex-1 bg-transparent px-3.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Notes <span className="font-normal">(optional)</span></label>
          <textarea
            placeholder="Any context about the client's situation, purpose, or urgency..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent resize-none"
          />
        </div>
      </GlassCard>

      {/* Attachments */}
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[15px] font-semibold text-foreground">Attachments <span className="text-[13px] font-normal text-muted-foreground">(optional)</span></p>
            <p className="text-[12px] text-muted-foreground mt-0.5">Payslips, bank statements, IDs</p>
          </div>
          <Button size="sm" variant="secondary" type="button" onClick={() => fileInput.current?.click()}>+ Add File</Button>
          <input ref={fileInput} type="file" className="hidden" onChange={handleFileAdd} />
        </div>
        {files.length === 0 ? (
          <button type="button" onClick={() => fileInput.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/40 transition-colors py-5 text-center"
          >
            <p className="text-[13px] text-muted-foreground">Click to attach files</p>
          </button>
        ) : (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
                <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                <span className="text-[13px] text-foreground flex-1 truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
            <button type="button" onClick={() => fileInput.current?.click()} className="text-[13px] text-primary hover:underline">
              + Add another file
            </button>
          </div>
        )}
      </GlassCard>

      <div className="flex gap-3 pb-6">
        <Button size="lg" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting...' : (submitLabel ?? 'Submit Lead')}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => navigate(basePath)}>Cancel</Button>
      </div>
    </div>
  );
}
