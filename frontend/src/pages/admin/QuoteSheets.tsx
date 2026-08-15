import { useCallback, useRef, useState, useEffect } from 'react';
import { Button, GlassCard, EmptyState, ListSkeleton } from '../../components/ui';
import QuoteSheetEditor from '../../components/QuoteSheetEditor';
import QuoteSheetComparison from '../../components/QuoteSheetComparison';
import { QUOTE_SHEET_STATUS_BADGE } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import api from '../../api/client';
import { migrateQuoteParams, optionTermMonths, termLabel, termLabelShort } from '../../lib/quoteTerms';
import type { QuoteSheet } from '../../types';

export default function QuoteSheets() {
  const { toast } = useToast();
  const [quoteSheets, setQuoteSheets] = useState<QuoteSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSheet, setEditingSheet] = useState<QuoteSheet | null>(null);
  const [viewingSheet, setViewingSheet] = useState<QuoteSheet | null>(null);
  const [pdfRenderSheet, setPdfRenderSheet] = useState<{ sheet: QuoteSheet; clientFacing: boolean } | null>(null);
  const viewKeyRef = useRef(0);

  // Send modal state
  const [sendModalSheet, setSendModalSheet] = useState<QuoteSheet | null>(null);
  const [sendModalTerms, setSendModalTerms] = useState<number[]>([]);
  const [sendingQuote, setSendingQuote] = useState(false);

  // Email modal state
  const [emailModalSheet, setEmailModalSheet] = useState<QuoteSheet | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailName, setEmailName] = useState('');
  const [emailTerms, setEmailTerms] = useState<number[]>([]);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    api.get('/quote-sheets')
      .then(({ data }) => setQuoteSheets(data))
      .catch(() => toast('Failed to load quote sheets', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleDownloadPdf = useCallback(async (sheet: QuoteSheet, clientFacing = false) => {
    setPdfRenderSheet({ sheet, clientFacing });
    await new Promise(r => setTimeout(r, 500));
    try {
      const suffix = clientFacing ? 'client' : 'internal';
      // Top margin 0 so the dark hero bleeds to the page's top edge; 22mm bottom
      // reserves room for the navy footer band painted on every page.
      await downloadQuoteSheetPdf(`quote-sheet-pdf-${sheet.id}`, `quote-v${sheet.version}-${suffix}.pdf`, [0, 0, 22, 0], true);
    } finally {
      setPdfRenderSheet(null);
    }
  }, []);

  const openEmailModal = (sheet: QuoteSheet) => {
    const terms = optionTermMonths(sheet.options);
    setEmailTerms(terms);
    setEmailTo(sheet.recipient_email || '');
    setEmailName(sheet.recipient_name || '');
    setEmailModalSheet(sheet);
  };

  const handleSendEmail = async () => {
    if (!emailModalSheet || !emailTo.trim()) return;
    setSendingEmail(true);
    try {
      await api.post(`/quote-sheets/${emailModalSheet.id}/send-email`, {
        to_email: emailTo.trim(),
        to_name: emailName.trim() || null,
        include_terms: emailTerms.length > 0 ? emailTerms : null,
        client_facing: true,
      });
      // Refresh the sheet to get updated recipient info
      const { data } = await api.get('/quote-sheets');
      setQuoteSheets(data);
      toast('Quote sheet emailed successfully', 'success');
      setEmailModalSheet(null);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to send email'), 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Quote Sheets</h1>
          <p className="text-sm text-muted-foreground mt-1">Create and manage standalone finance quotes</p>
        </div>
        <GlassCard>
          <ListSkeleton rows={4} rowHeight={84} />
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Quote Sheets</h1>
          <p className="text-sm text-muted-foreground mt-1">Create and manage standalone finance quotes</p>
        </div>
        {!showForm && !editingSheet && !viewingSheet && (
          <Button onClick={() => { setShowForm(true); setViewingSheet(null); setEditingSheet(null); }}>
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              New Quote Sheet
            </span>
          </Button>
        )}
      </div>

      {/* Editor Mode */}
      {(showForm || editingSheet) && (
        <QuoteSheetEditor
          quoteSheet={editingSheet || undefined}
          onSave={(sheet) => {
            setQuoteSheets(prev => {
              const idx = prev.findIndex(s => s.id === sheet.id);
              if (idx >= 0) return prev.map(s => s.id === sheet.id ? sheet : s);
              return [sheet, ...prev];
            });
            setShowForm(false);
            setEditingSheet(null);
          }}
          onCancel={() => { setShowForm(false); setEditingSheet(null); }}
        />
      )}

      {/* Viewing Mode */}
      {viewingSheet && !showForm && !editingSheet && (
        <GlassCard key={`view-${viewingSheet.id}-${viewKeyRef.current}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewingSheet(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
              </button>
              <h3 className="text-[15px] font-semibold">
                {viewingSheet.title || `Quote Sheet v${viewingSheet.version}`}
              </h3>
              <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${QUOTE_SHEET_STATUS_BADGE[viewingSheet.status].className}`}>
                {QUOTE_SHEET_STATUS_BADGE[viewingSheet.status].label}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleDownloadPdf(viewingSheet, false)}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  PDF
                </span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleDownloadPdf(viewingSheet, true)}
              >
                Client PDF
              </Button>
            </div>
          </div>
          {viewingSheet.recipient_name && (
            <p className="text-[12px] text-muted-foreground mb-3">
              Recipient: <span className="font-medium text-foreground">{viewingSheet.recipient_name}</span>
              {viewingSheet.recipient_email && <span> ({viewingSheet.recipient_email})</span>}
            </p>
          )}
          <QuoteSheetComparison quoteSheet={viewingSheet} showBrokerNotes />
        </GlassCard>
      )}

      {/* List Mode */}
      {!showForm && !editingSheet && !viewingSheet && (
        <GlassCard>
          {quoteSheets.length === 0 ? (
            <EmptyState
              title="No quote sheets yet"
              description="Create a standalone quote sheet to compare finance options"
            />
          ) : (
            <div className="space-y-3">
              {quoteSheets.map(sheet => (
                <div
                  key={sheet.id}
                  className="rounded-xl border border-border/60 bg-secondary/20 p-4 hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold text-foreground">v{sheet.version}</span>
                        {sheet.title && (
                          <span className="text-[13px] font-medium text-foreground truncate">{sheet.title}</span>
                        )}
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${QUOTE_SHEET_STATUS_BADGE[sheet.status].className}`}>
                          {QUOTE_SHEET_STATUS_BADGE[sheet.status].label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">
                          {sheet.options.length} option{sheet.options.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(sheet.created_at)}
                        </span>
                        {sheet.created_by_name && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-[11px] text-muted-foreground">by {sheet.created_by_name}</span>
                          </>
                        )}
                        {sheet.recipient_name && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-[11px] text-muted-foreground">
                              for {sheet.recipient_name}
                              {sheet.recipient_email && ` (${sheet.recipient_email})`}
                            </span>
                          </>
                        )}
                        {sheet.sent_at && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-[11px] text-success font-medium">Sent {formatDate(sheet.sent_at)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => { viewKeyRef.current++; setViewingSheet(sheet); setEditingSheet(null); setShowForm(false); }}
                      className="rounded-lg bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
                    >
                      View
                    </button>
                    {sheet.status === 'draft' && (
                      <button
                        onClick={() => { setEditingSheet(sheet); setShowForm(false); setViewingSheet(null); }}
                        className="rounded-lg bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {sheet.status === 'draft' && (
                      <button
                        onClick={() => {
                          const terms = optionTermMonths(sheet.options);
                          setSendModalTerms(terms);
                          setSendModalSheet(sheet);
                        }}
                        className="rounded-lg bg-success/10 px-3 py-1.5 text-[12px] font-medium text-success hover:bg-success/20 transition-colors"
                      >
                        Mark as Sent
                      </button>
                    )}
                    <button
                      onClick={() => openEmailModal(sheet)}
                      className="rounded-lg bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                        Email
                      </span>
                    </button>
                    <button
                      onClick={() => handleDownloadPdf(sheet, false)}
                      className="rounded-lg bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
                      title="Internal PDF (includes interest rate)"
                    >
                      PDF
                    </button>
                    <button
                      onClick={() => handleDownloadPdf(sheet, true)}
                      className="rounded-lg bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 transition-colors"
                      title="Client PDF (no interest rate)"
                    >
                      Client PDF
                    </button>
                    {sheet.status === 'draft' && (
                      <button
                        onClick={async () => {
                          try {
                            await api.delete(`/quote-sheets/${sheet.id}`);
                            setQuoteSheets(prev => prev.filter(s => s.id !== sheet.id));
                            toast('Quote sheet deleted', 'success');
                          } catch (err) {
                            toast(getErrorMessage(err, 'Failed to delete'), 'error');
                          }
                        }}
                        className="rounded-lg bg-destructive/10 px-3 py-1.5 text-[12px] font-medium text-destructive hover:bg-destructive/20 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Off-screen PDF render */}
      {pdfRenderSheet && (
        <div style={{ position: 'fixed', left: '-9999px', top: 0, width: '794px', background: 'white', padding: '24px' }}>
          <div id={`quote-sheet-pdf-${pdfRenderSheet.sheet.id}`}>
            <QuoteSheetComparison
              quoteSheet={pdfRenderSheet.sheet}
              isPdfExport={true}
              isClientView={pdfRenderSheet.clientFacing}
              clientName={pdfRenderSheet.sheet.recipient_name || undefined}
            />
          </div>
        </div>
      )}

      {/* Mark as Sent Modal */}
      {sendModalSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl border border-border w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-1">Mark Quote as Sent</h3>
            <p className="text-sm text-muted-foreground mb-5">Select which terms to include.</p>

            <div className="space-y-2.5 mb-6">
              {(() => {
                const allTerms = optionTermMonths(sendModalSheet.options);
                return allTerms.map(term => (
                  <label key={term} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendModalTerms.includes(term)}
                      onChange={e => {
                        if (e.target.checked) {
                          setSendModalTerms(prev => [...prev, term]);
                        } else {
                          setSendModalTerms(prev => prev.filter(t => t !== term));
                        }
                      }}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                    />
                    <span className="text-sm font-medium text-foreground">{termLabel(term)} Term</span>
                  </label>
                ));
              })()}
            </div>

            <div className="flex items-center gap-3">
              <Button
                loading={sendingQuote}
                disabled={sendModalTerms.length === 0}
                onClick={async () => {
                  setSendingQuote(true);
                  try {
                    let inputParams: Record<string, unknown> = {};
                    if (sendModalSheet.input_parameters) {
                      try { inputParams = migrateQuoteParams(JSON.parse(sendModalSheet.input_parameters)); } catch { /* empty */ }
                    }
                    // Terms are months — mark the blob so it isn't re-migrated.
                    inputParams.terms_in_months = true;
                    inputParams.selected_terms = sendModalTerms;

                    await api.patch(`/quote-sheets/${sendModalSheet.id}`, {
                      status: 'sent',
                      input_parameters: JSON.stringify(inputParams),
                    });
                    const { data } = await api.get('/quote-sheets');
                    setQuoteSheets(data);
                    toast('Quote sheet marked as sent', 'success');
                    setSendModalSheet(null);
                  } catch (err) {
                    toast(getErrorMessage(err, 'Failed to update'), 'error');
                  } finally {
                    setSendingQuote(false);
                  }
                }}
              >
                Confirm ({sendModalTerms.length} term{sendModalTerms.length !== 1 ? 's' : ''})
              </Button>
              <Button variant="secondary" onClick={() => setSendModalSheet(null)} disabled={sendingQuote}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {emailModalSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
            onClick={() => !sendingEmail && setEmailModalSheet(null)}
          />
          <div
            className="relative w-full max-w-[480px] rounded-2xl bg-background border border-border shadow-xl overflow-hidden"
            style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[17px] font-semibold text-foreground">
                    Send Quote via Email
                  </h3>
                  <p className="text-[13px] text-muted-foreground mt-0.5">
                    {emailModalSheet.title || `Quote Sheet v${emailModalSheet.version}`}
                  </p>
                </div>
                <button
                  onClick={() => !sendingEmail && setEmailModalSheet(null)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors -mt-1 -mr-1"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Form */}
            <div className="px-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Email</label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={e => setEmailTo(e.target.value)}
                    placeholder="client@example.com"
                    autoFocus
                    className="w-full h-[42px] rounded-xl bg-secondary px-3.5 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Name (optional)</label>
                  <input
                    type="text"
                    value={emailName}
                    onChange={e => setEmailName(e.target.value)}
                    placeholder="John Smith"
                    className="w-full h-[42px] rounded-xl bg-secondary px-3.5 text-[14px] text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Include Terms</label>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const allTerms = optionTermMonths(emailModalSheet.options);
                    return allTerms.map(term => {
                      const selected = emailTerms.includes(term);
                      return (
                        <button
                          key={term}
                          type="button"
                          onClick={() => {
                            setEmailTerms(prev =>
                              selected ? prev.filter(t => t !== term) : [...prev, term]
                            );
                          }}
                          className={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all duration-150 border ${
                            selected
                              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                              : 'bg-secondary/60 text-muted-foreground border-border hover:bg-secondary hover:text-foreground'
                          }`}
                        >
                          {termLabelShort(term)}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-5 mt-4 border-t border-border bg-muted/20 flex items-center justify-between">
              <p className="text-[12px] text-muted-foreground">
                {emailTerms.length === 0
                  ? 'Select at least one term'
                  : `${emailTerms.length} term${emailTerms.length !== 1 ? 's' : ''} selected`}
              </p>
              <div className="flex items-center gap-2.5">
                <Button variant="secondary" size="sm" onClick={() => setEmailModalSheet(null)} disabled={sendingEmail}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={sendingEmail}
                  disabled={!emailTo.trim() || emailTerms.length === 0}
                  onClick={handleSendEmail}
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                    Send
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
