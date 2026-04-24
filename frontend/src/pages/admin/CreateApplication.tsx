import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, avatarColor, getInitials } from '../../lib/utils';
import type { LoanType, User } from '../../types';

function Icon({ name, size = 14, strokeWidth = 1.75, className = '' }: { name: string; size?: number; strokeWidth?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevronLeft: <path d="m15 6-6 6 6 6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    home: <path d="M3 12 12 4l9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
    car: <path d="M3 13h18l-2-6H5l-2 6Zm0 0v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2m10 0v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-4M7 16h.01M17 16h.01" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] || null}
    </svg>
  );
}

type ClientMode = 'existing' | 'new';

const LOAN_TYPES: { value: LoanType; label: string; icon: string }[] = [
  { value: 'personal', label: 'Personal', icon: 'user' },
  { value: 'home', label: 'Home', icon: 'home' },
  { value: 'business', label: 'Business', icon: 'briefcase' },
  { value: 'vehicle', label: 'Vehicle', icon: 'car' },
];

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-secondary px-3 py-2 text-[14px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

export default function CreateApplication() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mode, setMode] = useState<ClientMode>('existing');

  // Existing client
  const [clients, setClients] = useState<User[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<User | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // New client
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Application
  const [loanType, setLoanType] = useState<LoanType>('personal');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get('/users')
      .then(({ data }) => setClients(data.filter((u: User) => u.role === 'client')))
      .catch(() => {})
      .finally(() => setClientsLoading(false));
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'existing' && !selectedClient) {
      toast('Please select a client', 'error');
      return;
    }
    setSubmitting(true);
    try {
      let clientId: string;

      if (mode === 'new') {
        const { data: newUser } = await api.post('/invitations', {
          email: newEmail,
          full_name: newName,
          phone: newPhone || null,
        });
        clientId = newUser.id;
      } else {
        clientId = selectedClient!.id;
      }

      const { data } = await api.post('/invitations/start-application', {
        client_id: clientId,
        loan_type: loanType,
        amount: parseFloat(amount),
        notes: notes || null,
      });

      toast('Application created', 'success');
      navigate(`/admin/applications/${data.application_id}`);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to create application'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    !!amount &&
    parseFloat(amount) > 0 &&
    (mode === 'new' ? !!newName && !!newEmail : !!selectedClient);

  return (
    <div className="ledger-theme led-fade-up" style={{ minHeight: '100%', background: 'var(--led-bg)', margin: -24, padding: 0 }}>
      {/* Header */}
      <header style={{ padding: '20px 24px 20px', background: 'var(--led-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <button
            type="button"
            className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
            onClick={() => navigate('/admin/applications')}
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <h1 className="led-h-page" style={{ margin: 0 }}>New Application</h1>
        </div>
        <p style={{ margin: '0 0 0 40px', fontSize: 13, color: 'var(--led-muted)' }}>
          Create a draft application and notify the client by email.
        </p>
      </header>

      <div style={{ padding: '0 24px 40px', maxWidth: 660 }}>
        <form onSubmit={handleSubmit}>
          {/* Client card — overflow visible so the dropdown isn't clipped */}
          <div className="led-card" style={{ padding: '20px 24px', marginBottom: 16, overflow: 'visible' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--led-ink)', marginBottom: 14 }}>Client</div>

            {/* Mode toggle */}
            <div className="led-segment" style={{ marginBottom: 16, width: 'fit-content' }}>
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
            </div>

            {/* Existing client search */}
            {mode === 'existing' && (
              <div ref={dropdownRef} style={{ position: 'relative' }}>
                {selectedClient ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--led-border)', background: 'var(--led-surface)' }}>
                    <span
                      className="led-avatar led-avatar-sm"
                      style={{ background: avatarColor(selectedClient.full_name) }}
                    >
                      {getInitials(selectedClient.full_name)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--led-ink)' }}>{selectedClient.full_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--led-muted)' }}>{selectedClient.email}</div>
                    </div>
                    <button
                      type="button"
                      className="led-btn led-btn-ghost led-btn-sm led-btn-icon"
                      onClick={() => { setSelectedClient(null); setSearch(''); }}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="led-search" style={{ width: '100%' }}>
                      <Icon name="search" size={13} />
                      <input
                        type="text"
                        placeholder="Search by name or email…"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                        onFocus={() => setDropdownOpen(true)}
                        style={{ width: '100%' }}
                        autoComplete="off"
                      />
                    </div>
                    {dropdownOpen && !clientsLoading && (
                      <div
                        className="led-popover"
                        style={{ top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, maxHeight: 280, overflowY: 'auto' }}
                      >
                        {filteredClients.length === 0 ? (
                          <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--led-muted)' }}>
                            {search ? `No clients matching "${search}"` : 'No clients yet — switch to New client to invite one'}
                          </div>
                        ) : filteredClients.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="led-popover-item"
                            style={{ height: 'auto', minHeight: 40, padding: '6px 10px', alignItems: 'center', gap: 10 }}
                            onClick={() => { setSelectedClient(c); setSearch(''); setDropdownOpen(false); }}
                          >
                            <span
                              className="led-avatar led-avatar-sm"
                              style={{ background: avatarColor(c.full_name), flexShrink: 0 }}
                            >
                              {getInitials(c.full_name)}
                            </span>
                            <div style={{ minWidth: 0, textAlign: 'left' }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--led-ink)', lineHeight: 1.3 }}>{c.full_name}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--led-muted)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--led-ink-2)', marginBottom: 6 }}>
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    className={INPUT_CLASS}
                    placeholder="Jane Smith"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--led-ink-2)', marginBottom: 6 }}>
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    className={INPUT_CLASS}
                    placeholder="jane@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--led-ink-2)', marginBottom: 6 }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    className={INPUT_CLASS}
                    placeholder="0412 345 678"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Loan details card */}
          <div className="led-card" style={{ padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--led-ink)', marginBottom: 16 }}>Loan Details</div>

            {/* Loan type */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--led-ink-2)', marginBottom: 8 }}>
                Type *
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {LOAN_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setLoanType(t.value)}
                    className={`led-btn led-btn-sm ${loanType === t.value ? 'led-btn-primary' : 'led-btn-outline'}`}
                    style={{ gap: 6 }}
                  >
                    <Icon name={t.icon} size={12} /> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--led-ink-2)', marginBottom: 6 }}>
                Amount *
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--led-muted)', pointerEvents: 'none' }}>
                  $
                </span>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  className={INPUT_CLASS}
                  style={{ paddingLeft: 24 }}
                  placeholder="50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--led-ink-2)', marginBottom: 6 }}>
                Notes
              </label>
              <textarea
                className={INPUT_CLASS}
                placeholder="Optional notes for the client…"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ resize: 'vertical', minHeight: 72 }}
              />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="led-btn led-btn-outline"
              onClick={() => navigate('/admin/applications')}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="led-btn led-btn-primary"
              disabled={!canSubmit}
            >
              {submitting ? 'Creating…' : 'Create Application'}
              {!submitting && <Icon name="chevronRight" size={14} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
