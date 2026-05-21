import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import DocumentUploader from '../../components/DocumentUploader';
import QuoteSheetComparison from '../../components/QuoteSheetComparison';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate, formatDateTime } from '../../lib/utils';
import { GlassCard, Badge, Button, ConfirmDialog } from '../../components/ui';
import { DOC_TYPE_LABELS, QUOTE_SHEET_STATUS_BADGE, RECOMMENDED_DOC_TYPES } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import { useAuth } from '../../hooks/useAuth';
import type { ClientMessage, Document, DocumentRequest, LoanApplication, QuoteSheet } from '../../types';

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [newClientMsgContent, setNewClientMsgContent] = useState('');
  const [sendingClientMsg, setSendingClientMsg] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState('id_proof');
  const [docLabel, setDocLabel] = useState('');
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);
  const [deletingApp, setDeletingApp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [quoteSheets, setQuoteSheets] = useState<QuoteSheet[]>([]);
  const [pdfRenderSheet, setPdfRenderSheet] = useState<QuoteSheet | null>(null);
  const [pdfRenderApp, setPdfRenderApp] = useState(false);
  const [downloadingAppPdf, setDownloadingAppPdf] = useState(false);
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [fulfillingRequestId, setFulfillingRequestId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'documents' | 'messages'>('overview');

  const handleDownloadAppPdf = async () => {
    if (!application) return;
    setDownloadingAppPdf(true);
    setPdfRenderApp(true);
    await new Promise(r => setTimeout(r, 150));
    try {
      const filename = `application-${application.id.split('-')[0].toUpperCase()}.pdf`;
      await downloadQuoteSheetPdf('application-pdf-render', filename);
    } catch {
      toast('Failed to generate PDF', 'error');
    } finally {
      setPdfRenderApp(false);
      setDownloadingAppPdf(false);
    }
  };

  const handleDownloadPdf = async (sheet: QuoteSheet) => {
    setPdfRenderSheet(sheet);
    // Wait for React to mount the off-screen element
    await new Promise(r => setTimeout(r, 100));
    try {
      await downloadQuoteSheetPdf(`quote-sheet-pdf-${sheet.id}`, `quote-sheet-v${sheet.version}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF', err);
      toast('Failed to generate PDF', 'error');
    } finally {
      setPdfRenderSheet(null);
    }
  };

  const uploadedDocTypes = new Set(documents.map((d) => d.doc_type));
  const missingDocs = RECOMMENDED_DOC_TYPES.filter((t) => !uploadedDocTypes.has(t));
  const allDocsUploaded = missingDocs.length === 0;

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/applications/${id}`),
      api.get(`/documents/application/${id}`),
    ])
      .then(([appRes, docRes]) => {
        setApplication(appRes.data);
        setDocuments(docRes.data);
      })
      .catch(() => toast('Failed to load application', 'error'))
      .finally(() => setLoading(false));
    // Fetch sent quote sheets (backend filters to sent-only for clients)
    api.get(`/applications/${id}/quote-sheets`).then(({ data }) => setQuoteSheets(data)).catch(() => { });
    api.get(`/documents/requests/${id}`).then(({ data }) => setDocRequests(data)).catch(() => { });
  }, [id]);

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/clients/${user.id}/messages`)
      .then(({ data }) => setClientMessages(data))
      .catch(() => { });
  }, [user?.id]);

  const handleUploadFile = async (file: File, label?: string) => {
    if (!id) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      let url = `/documents/upload/${id}?doc_type=${docType}`;
      if (label) {
        url += `&label=${encodeURIComponent(label)}`;
      }
      const { data } = await api.post(url, formData);
      setDocuments((prev) => [...prev, data]);
      setDocLabel(''); // Clear label after successful upload
      toast('Document uploaded successfully', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
    }
  };


  const handleFulfillRequest = async (requestId: string) => {
    setFulfillingRequestId(requestId);
    try {
      const { data } = await api.patch(`/documents/requests/${requestId}/fulfill`);
      setDocRequests((prev) => prev.map((r) => (r.id === requestId ? data : r)));
      toast('Request marked as fulfilled', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update request'), 'error');
    } finally {
      setFulfillingRequestId(null);
    }
  };

  const handleDeleteApplication = async () => {
    if (!id) return;
    setDeletingApp(true);
    try {
      await api.delete(`/applications/${id}`);
      toast('Application deleted', 'success');
      navigate('/applications');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to delete application'), 'error');
      setDeletingApp(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSubmitApplication = async () => {
    if (!id || !application) return;
    setSubmittingApplication(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, { status: 'application_received' });
      setApplication(data);
      toast('Application submitted for review!', 'success');
      setShowSubmitConfirm(false);
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to submit'), 'error');
    } finally {
      setSubmittingApplication(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="space-y-6">
          <div className="h-6 w-40 rounded shimmer" />
          <div className="h-32 rounded-2xl shimmer" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 h-64 rounded-2xl shimmer" />
            <div className="h-48 rounded-2xl shimmer" />
          </div>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)] mb-4">
          <svg className="h-8 w-8 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
        </div>
        <p className="text-[15px] text-[var(--led-muted)] font-medium">Application not found</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2">
        <Link
          to="/applications"
          className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--led-muted)] hover:text-[var(--led-accent)] transition-colors mb-4"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          Back to Applications
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="led-chip led-chip-accent">Application</span>
              <Badge value={application.status} />
            </div>
            <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)] capitalize">
              {application.loan_type} Loan Application
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleDownloadAppPdf} loading={downloadingAppPdf} disabled={downloadingAppPdf}>
              <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              Download PDF
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[14px] leading-6 text-[var(--led-muted)]">
          {application.loan_type} loan &middot; ${Number(application.amount).toLocaleString()}
        </p>
      </div>

      {/* Status Timeline */}
      <GlassCard padding="none" className="mb-6">
        <div className="border-b border-[var(--led-line)] px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Progress</p>
          <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Application Progress</h2>
        </div>
        <div className="p-6">
          <StatusTimeline currentStatus={application.status} />
        </div>
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-0 border-b border-[var(--led-line)] mb-6 scrollbar-none">
            {([
              { key: 'overview', label: 'Overview' },
              { key: 'details', label: 'Full Details' },
              { key: 'documents', label: 'Documents' },
              { key: 'messages', label: 'Messages' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`whitespace-nowrap px-4 py-3 text-[14px] font-semibold transition-all duration-300 relative ${activeTab === key ? 'text-[var(--led-accent)]' : 'text-[var(--led-muted)] hover:text-[var(--led-ink)] hover:bg-[var(--led-surface-2)] rounded-t-lg'}`}
              >
                {label}
                {activeTab === key && (
                  <div className="absolute bottom-[-1px] left-0 w-full h-[2px] bg-[var(--led-accent)] rounded-t-full" />
                )}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
          <>
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Summary</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Application Overview</h2>
            </div>
            <div className="p-6">
            {application.lend_ref && (
              <div className="mb-4 rounded-[14px] bg-[var(--led-success)]/10 border border-[var(--led-success)]/20 px-4 py-2.5">
                <span className="text-[13px] font-medium text-[var(--led-success)]">Lend Ref: {application.lend_ref}</span>
              </div>
            )}
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Amount</dt>
                <dd className="mt-2 text-[22px] font-semibold tracking-[-0.03em] led-tnum text-[var(--led-ink)]">
                  ${Number(application.amount).toLocaleString()}
                </dd>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Loan Type</dt>
                <dd className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--led-ink)] capitalize">{application.loan_type}</dd>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Created</dt>
                <dd className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">
                  {formatDate(application.created_at)}
                </dd>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Last Updated</dt>
                <dd className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">
                  {formatDate(application.updated_at)}
                </dd>
              </div>
            </dl>
            {application.notes && (
              <div className="mt-5 rounded-xl bg-[var(--led-surface-2)]/50 p-4">
                <dt className="text-[13px] font-medium text-[var(--led-muted)] mb-1">Notes</dt>
                <dd className="text-[14px] text-[var(--led-ink)]">{application.notes}</dd>
              </div>
            )}

            {application.status === 'draft' && (
              <div className="mt-6 pt-5 border-t border-[var(--led-line)]">
                <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Recommended Documents</h3>
                <div className="grid gap-2 sm:grid-cols-2 mb-4">
                  {RECOMMENDED_DOC_TYPES.map((type) => (
                    <div key={type} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] transition-all duration-200 ${uploadedDocTypes.has(type) ? 'bg-[var(--led-success)]/10 text-[var(--led-success)]' : 'bg-[var(--led-surface-2)] text-[var(--led-muted)]'}`}>
                      {uploadedDocTypes.has(type) ? (
                        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                      ) : (
                        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><circle cx="12" cy="12" r="9" /></svg>
                      )}
                      <span className="font-medium">{DOC_TYPE_LABELS[type]}</span>
                    </div>
                  ))}
                </div>
                {!allDocsUploaded && (
                  <p className="text-[12px] text-[var(--led-muted)] mb-3">You can submit now — missing documents may be requested during review.</p>
                )}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <Button
                    variant={allDocsUploaded ? 'success' : 'primary'}
                    size="lg"
                    onClick={() => setShowSubmitConfirm(true)}
                    loading={submittingApplication}
                    disabled={submittingApplication}
                    className="flex-1"
                  >
                    Submit for Review
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete Draft
                  </Button>
                </div>
            </div>
          )}
          </div>
          </GlassCard>

          </>
          )}

          {activeTab === 'details' && (
          <>
          {/* Personal Details */}
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Applicant</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Personal Details</h2>
            </div>
            <div className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)] p-3.5 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Full Name</p>
                <p className="mt-1 text-[14px] font-medium text-[var(--led-ink)]">
                  {[application.applicant_title, application.applicant_first_name, application.applicant_middle_name, application.applicant_last_name].filter(Boolean).join(' ') || '—'}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Date of Birth</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_dob || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Gender</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)] capitalize">{application.applicant_gender || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Marital Status</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)] capitalize">{application.applicant_marital_status || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Dependants</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_num_dependants ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Mobile</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_mobile || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Preferred Contact</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)] capitalize">{application.preferred_contact_method || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Residency Status</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_residency_status || '—'}</p>
              </div>
            </div>
          </div>
          </GlassCard>

          {/* Address & Living Situation */}
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Residence</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Address & Living Situation</h2>
            </div>
            <div className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)] p-3.5 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Address</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">
                  {[application.applicant_address, application.applicant_suburb, application.applicant_state, application.applicant_postcode].filter(Boolean).join(', ') || '—'}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Residential Status</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)] capitalize">{application.residential_status || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Time at Address</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.time_at_address || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Has Partner</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.has_partner != null ? (application.has_partner ? 'Yes' : 'No') : '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Partner Working</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.partner_working != null ? (application.partner_working ? 'Yes' : 'No') : '—'}</p>
              </div>
            </div>
          </div>
          </GlassCard>

          {/* Employment */}
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Work</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Employment</h2>
            </div>
            <div className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)] p-3.5 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Employment Type</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)] capitalize">{application.employment_category || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Employer</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.employer_name || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Job Title</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.job_title || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Industry</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.employer_industry || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Gross Income</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">
                  {application.gross_income != null ? `$${Number(application.gross_income).toLocaleString()}${application.income_frequency ? ` / ${application.income_frequency}` : ''}` : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Business Name</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_name || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Trading Name</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.trading_name || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">ABN</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_abn || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Business Structure</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_structure || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Time Trading</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.time_trading || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">GST Registered</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.gst_registered != null ? (application.gst_registered ? 'Yes' : 'No') : '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Number of Directors</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.num_directors ?? '—'}</p>
              </div>
            </div>
          </div>
          </GlassCard>

          {/* Loan Type Details (from lend_extra_data) */}
          {application.lend_extra_data && (() => {
            try {
              const extraData = JSON.parse(application.lend_extra_data);
              const loanDetails = extraData.loan_type_details;
              if (!loanDetails) return null;
              return (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-[var(--led-ink)] mb-5">Loan Type Details</h2>
                  <div className="space-y-4">
                    {loanDetails.consumer_loan_type && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                        <p className="text-[12px] text-[var(--led-muted)]">Consumer Loan Type</p>
                        <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.consumer_loan_type.label || '—'}</p>
                      </div>
                    )}
                    {loanDetails.commercial_loan_type && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                        <p className="text-[12px] text-[var(--led-muted)]">Commercial Loan Type</p>
                        <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.commercial_loan_type.label || '—'}</p>
                      </div>
                    )}
                    {loanDetails.vehicle_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Vehicle Information</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div><p className="text-[12px] text-[var(--led-muted)]">Make</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.make || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Model</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.model || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Year</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.year || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Condition</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.condition || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Price</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.price > 0 ? `$${Number(loanDetails.vehicle_details.price).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Deposit</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.deposit > 0 ? `$${Number(loanDetails.vehicle_details.deposit).toLocaleString()}` : '—'}</p></div>
                        </div>
                      </div>
                    )}
                    {loanDetails.property_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Property Information</p>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Address</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.address || '—'}</p></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div><p className="text-[12px] text-[var(--led-muted)]">Property Type</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.property_type || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Property Use</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.property_use || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Property Value</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.value > 0 ? `$${Number(loanDetails.property_details.value).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Deposit</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.deposit > 0 ? `$${Number(loanDetails.property_details.deposit).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">First Home Buyer</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.first_home_buyer != null ? (loanDetails.property_details.first_home_buyer ? 'Yes' : 'No') : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Current Lender</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.current_lender || '—'}</p></div>
                        </div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Refinance Reason</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.refinance_reason || '—'}</p></div>
                      </div>
                    )}
                    {loanDetails.asset_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Asset Information</p>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Asset Type</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.equipment_type || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Description</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.description || '—'}</p></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div><p className="text-[12px] text-[var(--led-muted)]">Price</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.price > 0 ? `$${Number(loanDetails.asset_details.price).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Deposit</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.deposit > 0 ? `$${Number(loanDetails.asset_details.deposit).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Vendor Type</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.vendor_type || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Business Use %</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.business_use_pct > 0 ? `${loanDetails.asset_details.business_use_pct}%` : '—'}</p></div>
                        </div>
                      </div>
                    )}
                    {loanDetails.business_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Business Information</p>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Business Plan</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.business_plan || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Business Details</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.business_details || '—'}</p></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div><p className="text-[12px] text-[var(--led-muted)]">Startup Costs</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.startup_costs > 0 ? `$${Number(loanDetails.business_details.startup_costs).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Purchase Price</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.purchase_price > 0 ? `$${Number(loanDetails.business_details.purchase_price).toLocaleString()}` : '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Industry</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.industry || '—'}</p></div>
                          <div><p className="text-[12px] text-[var(--led-muted)]">Business Type</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.business_type || '—'}</p></div>
                        </div>
                      </div>
                    )}
                    {loanDetails.working_capital && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Working Capital Details</p>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Expansion Plans</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.expansion_description || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Recruitment Details</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.recruitment_details || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Supplier Details</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.supplier_details || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Outstanding Invoices</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.outstanding_invoices || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Purpose</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.purpose_description || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Loan Amount</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.loan_amount > 0 ? `$${Number(loanDetails.working_capital.loan_amount).toLocaleString()}` : '—'}</p></div>
                      </div>
                    )}
                    {loanDetails.personal_loan && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Personal Loan Details</p>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Purpose</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.personal_loan.purpose || '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Amount</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.personal_loan.amount > 0 ? `$${Number(loanDetails.personal_loan.amount).toLocaleString()}` : '—'}</p></div>
                        <div><p className="text-[12px] text-[var(--led-muted)]">Term</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.personal_loan.term || '—'}</p></div>
                      </div>
                    )}
                  </div>
                </GlassCard>
              );
            } catch {
              return null;
            }
          })()}

          {/* Emergency Contact */}
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Contact</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Emergency Contact</h2>
            </div>
            <div className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--led-surface-2)] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--led-muted)]">Name</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.emergency_contact_name || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Relationship</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.emergency_contact_relationship || '—'}</p>
              </div>
              <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3.5">
                <p className="text-[12px] text-[var(--led-muted)]">Phone</p>
                <p className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.emergency_contact_phone || '—'}</p>
              </div>
            </div>
          </div>
          </GlassCard>

          {/* Referrer Info */}
          {application.referrer && (
            <GlassCard padding="none">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Referral</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Referred By</h2>
              </div>
              <div className="p-6">
              <div className="flex items-center gap-4 rounded-xl bg-[var(--led-surface-2)]/50 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--led-accent)]/10 text-[var(--led-accent)]">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[var(--led-ink)]">{application.referrer.full_name || '—'}</p>
                  {application.referrer.organization_name && (
                    <p className="text-[12px] text-[var(--led-muted)]">{application.referrer.organization_name}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {application.referrer.email && (
                      <a href={`mailto:${application.referrer.email}`} className="text-[13px] text-[var(--led-accent)] hover:underline">{application.referrer.email}</a>
                    )}
                    {application.referrer.phone && (
                      <span className="text-[13px] text-[var(--led-muted)]">{application.referrer.phone}</span>
                    )}
                  </div>
                </div>
              </div>
              {application.client_engagement_model && (
                <div className="mt-3 rounded-xl bg-[var(--led-surface-2)]/30 p-3">
                  <p className="text-[12px] text-[var(--led-muted)]">
                    {application.client_engagement_model === 'self_managed'
                      ? 'Your referrer will manage the client relationship.'
                      : 'The broker may engage you directly.'}
                  </p>
                </div>
              )}
            </div>
            </GlassCard>
          )}

          {/* Applicant Details */}
          {application.applicant_first_name && (
            <GlassCard padding="none">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Full Details</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Applicant Details</h2>
              </div>
              <div className="p-6">
              
              {/* Personal Information */}
              <div className="mb-5">
                <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Personal Information</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                    <dt className="text-[12px] font-medium text-[var(--led-muted)]">Full Name</dt>
                    <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">
                      {application.applicant_title} {application.applicant_first_name} {application.applicant_middle_name} {application.applicant_last_name}
                    </dd>
                  </div>
                  {application.applicant_dob && (
                    <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                      <dt className="text-[12px] font-medium text-[var(--led-muted)]">Date of Birth</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_dob}</dd>
                    </div>
                  )}
                  {application.applicant_gender && (
                    <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                      <dt className="text-[12px] font-medium text-[var(--led-muted)]">Gender</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_gender}</dd>
                    </div>
                  )}
                  {application.applicant_marital_status && (
                    <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                      <dt className="text-[12px] font-medium text-[var(--led-muted)]">Marital Status</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_marital_status}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Contact Information */}
              {(application.applicant_mobile || application.preferred_contact_method || application.user_email) && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Contact Information</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.applicant_mobile && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Mobile Phone</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_mobile}</dd>
                      </div>
                    )}
                    {application.user_email && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Email Address</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.user_email}</dd>
                      </div>
                    )}
                    {application.preferred_contact_method && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Preferred Contact Method</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.preferred_contact_method}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Address */}
              {application.applicant_address && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Address</h3>
                  <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3 mb-3">
                    <dt className="text-[12px] font-medium text-[var(--led-muted)]">Street Address</dt>
                    <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">
                      {application.applicant_address}, {application.applicant_suburb} {application.applicant_state} {application.applicant_postcode}
                    </dd>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.residential_status && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Residential Status</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.residential_status}</dd>
                      </div>
                    )}
                    {application.time_at_address && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Time at Address</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.time_at_address}</dd>
                      </div>
                    )}
                    {application.applicant_num_dependants !== null && application.applicant_num_dependants !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Number of Dependants</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_num_dependants}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Living Situation */}
              {(application.has_partner !== null || application.partner_working !== null || application.applicant_residency_status || application.id_expiry_date) && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Living Situation</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.has_partner !== null && application.has_partner !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Has Partner</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.has_partner ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.partner_working !== null && application.partner_working !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Partner Working</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.partner_working ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.applicant_residency_status && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Residency Status</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.applicant_residency_status}</dd>
                      </div>
                    )}
                    {application.id_expiry_date && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">ID Expiry Date</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.id_expiry_date}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Employment Information */}
              {(application.employment_category || application.employer_name || application.job_title || application.gross_income) && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Employment Information</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.employment_category && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Employment Category</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.employment_category}</dd>
                      </div>
                    )}
                    {application.employer_name && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Employer Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.employer_name}</dd>
                      </div>
                    )}
                    {application.employer_industry && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Employer Industry</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.employer_industry}</dd>
                      </div>
                    )}
                    {application.job_title && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Job Title</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.job_title}</dd>
                      </div>
                    )}
                    {application.income_frequency && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Income Frequency</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.income_frequency}</dd>
                      </div>
                    )}
                    {application.gross_income && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Gross Income</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(application.gross_income).toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Business Information */}
              {(application.business_name || application.business_abn || application.trading_name || application.business_structure) && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Business Information</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.business_name && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_name}</dd>
                      </div>
                    )}
                    {application.trading_name && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Trading Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.trading_name}</dd>
                      </div>
                    )}
                    {application.business_abn && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">ABN</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_abn}</dd>
                      </div>
                    )}
                    {application.business_structure && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Structure</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_structure}</dd>
                      </div>
                    )}
                    {application.business_registration_date && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Registration Date</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.business_registration_date}</dd>
                      </div>
                    )}
                    {application.time_trading && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Time Trading</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.time_trading}</dd>
                      </div>
                    )}
                    {application.gst_registered !== null && application.gst_registered !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">GST Registered</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.gst_registered ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.num_directors !== null && application.num_directors !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Number of Directors</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.num_directors}</dd>
                      </div>
                    )}
                    {application.business_monthly_sales && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Monthly Sales</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(application.business_monthly_sales).toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Loan Details */}
              {(application.loan_term_requested || application.loan_purpose_id) && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Loan Details</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.loan_term_requested && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Term</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.loan_term_requested} months</dd>
                      </div>
                    )}
                    {application.loan_purpose_id && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Purpose ID</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.loan_purpose_id}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Emergency Contact */}
              {application.emergency_contact_name && (
                <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Emergency Contact</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                      <dt className="text-[12px] font-medium text-[var(--led-muted)]">Name</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.emergency_contact_name}</dd>
                    </div>
                    {application.emergency_contact_relationship && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Relationship</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.emergency_contact_relationship}</dd>
                      </div>
                    )}
                    {application.emergency_contact_phone && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Phone</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.emergency_contact_phone}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Declarations */}
              {(application.previously_declined !== null || application.change_of_circumstances !== null || application.signature_name) && (
                <div className="pt-4 border-t border-[var(--led-line)]">
                  <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Declarations</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.previously_declined !== null && application.previously_declined !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Previously Declined</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.previously_declined ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.change_of_circumstances !== null && application.change_of_circumstances !== undefined && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Change of Circumstances</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.change_of_circumstances ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.signature_name && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3 sm:col-span-2">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Signature Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{application.signature_name}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
            </GlassCard>
          )}

          {/* Loan Type Details from lend_extra_data */}
          {application.lend_extra_data && (() => {
            try {
              const extraData = JSON.parse(application.lend_extra_data);
              const loanDetails = extraData.loan_type_details;
              if (!loanDetails || Object.keys(loanDetails).length === 0) return null;

              return (
                <GlassCard padding="none">
                  <div className="border-b border-[var(--led-line)] px-6 py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Financing</p>
                    <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Loan Type Details</h2>
                  </div>
                  <div className="p-6">
                  <div className="space-y-4">
                    {/* Consumer/Commercial loan type label */}
                    {(loanDetails.consumer_loan_type || loanDetails.commercial_loan_type) && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Category</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">
                          {loanDetails.consumer_loan_type?.label || loanDetails.commercial_loan_type?.label}
                        </dd>
                      </div>
                    )}

                    {/* Vehicle Details */}
                    {loanDetails.vehicle_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Vehicle Information</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.vehicle_details.make && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Make</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.make}</dd></div>
                          )}
                          {loanDetails.vehicle_details.model && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Model</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.model}</dd></div>
                          )}
                          {loanDetails.vehicle_details.year && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Year</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.year}</dd></div>
                          )}
                          {loanDetails.vehicle_details.condition && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Condition</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.condition}</dd></div>
                          )}
                          {loanDetails.vehicle_details.vin && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">VIN</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.vin}</dd></div>
                          )}
                          {loanDetails.vehicle_details.price > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Price</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.vehicle_details.price).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.vehicle_details.deposit > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Deposit</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.vehicle_details.deposit).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.vehicle_details.term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.vehicle_details.term}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* Property Details */}
                    {loanDetails.property_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Property Information</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.property_details.address && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Address</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.address}</dd></div>
                          )}
                          {loanDetails.property_details.property_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Property Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.property_type}</dd></div>
                          )}
                          {loanDetails.property_details.property_use && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Property Use</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.property_use}</dd></div>
                          )}
                          {loanDetails.property_details.value > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Property Value</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.property_details.value).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.property_details.deposit > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Deposit</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.property_details.deposit).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.property_details.first_home_buyer !== undefined && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">First Home Buyer</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.first_home_buyer ? 'Yes' : 'No'}</dd></div>
                          )}
                          {loanDetails.property_details.current_lender && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Current Lender</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.current_lender}</dd></div>
                          )}
                          {loanDetails.property_details.current_balance > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Current Balance</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.property_details.current_balance).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.property_details.refinance_reason && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Refinance Reason</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.refinance_reason}</dd></div>
                          )}
                          {loanDetails.property_details.term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.term}</dd></div>
                          )}
                          {loanDetails.property_details.project_description && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Project Description</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.project_description}</dd></div>
                          )}
                          {loanDetails.property_details.fit_out_description && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Fit-out Description</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.fit_out_description}</dd></div>
                          )}
                          {loanDetails.property_details.renovation_description && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Renovation Details</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.property_details.renovation_description}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* Personal Loan */}
                    {loanDetails.personal_loan && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Personal Loan Details</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.personal_loan.purpose && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Purpose</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.personal_loan.purpose}</dd></div>
                          )}
                          {loanDetails.personal_loan.amount > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Amount</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.personal_loan.amount).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.personal_loan.term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.personal_loan.term}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* Commercial Asset Details */}
                    {loanDetails.asset_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Asset Details</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.asset_details.equipment_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Equipment Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.equipment_type}</dd></div>
                          )}
                          {loanDetails.asset_details.condition && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Condition</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.condition}</dd></div>
                          )}
                          {loanDetails.asset_details.description && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Description</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.description}</dd></div>
                          )}
                          {loanDetails.asset_details.price > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Price</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.asset_details.price).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.asset_details.deposit > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Deposit / Trade-in</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.asset_details.deposit).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.asset_details.vendor_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Vendor Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.vendor_type}</dd></div>
                          )}
                          {loanDetails.asset_details.business_use_pct > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Use</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.business_use_pct}%</dd></div>
                          )}
                          {loanDetails.asset_details.term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.asset_details.term}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* Business Acquisition/Startup */}
                    {loanDetails.business_details && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Business Details</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.business_details.business_plan && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Plan</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.business_plan}</dd></div>
                          )}
                          {loanDetails.business_details.business_details && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Description</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.business_details}</dd></div>
                          )}
                          {loanDetails.business_details.industry && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Industry</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.industry}</dd></div>
                          )}
                          {loanDetails.business_details.business_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.business_type}</dd></div>
                          )}
                          {loanDetails.business_details.startup_costs > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Startup Costs</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.business_details.startup_costs).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.business_details.purchase_price > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Purchase Price</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.business_details.purchase_price).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.business_details.loan_amount > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Amount</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.business_details.loan_amount).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.business_details.term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_details.term}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* Working Capital */}
                    {loanDetails.working_capital && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Working Capital</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.working_capital.recruitment_details && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Recruitment Details</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.recruitment_details}</dd></div>
                          )}
                          {loanDetails.working_capital.expansion_description && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Expansion Plans</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.expansion_description}</dd></div>
                          )}
                          {loanDetails.working_capital.supplier_details && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Supplier Details</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.supplier_details}</dd></div>
                          )}
                          {loanDetails.working_capital.outstanding_invoices && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Outstanding Invoices</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.outstanding_invoices}</dd></div>
                          )}
                          {loanDetails.working_capital.purpose_description && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Purpose</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.purpose_description}</dd></div>
                          )}
                          {loanDetails.working_capital.loan_amount > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Amount</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.working_capital.loan_amount).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.working_capital.term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.working_capital.term}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* LEND mode: Equipment Finance */}
                    {loanDetails.equipment_finance && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Equipment Finance</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.equipment_finance.asset_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Asset Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.equipment_finance.asset_type}</dd></div>
                          )}
                          {loanDetails.equipment_finance.new_or_used && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">New or Used</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.equipment_finance.new_or_used}</dd></div>
                          )}
                          {loanDetails.equipment_finance.asset_price > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Asset Price</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.equipment_finance.asset_price).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.equipment_finance.deposit_amount > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Deposit</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.equipment_finance.deposit_amount).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.equipment_finance.vendor_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Vendor Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.equipment_finance.vendor_type}</dd></div>
                          )}
                          {loanDetails.equipment_finance.loan_term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.equipment_finance.loan_term} years</dd></div>
                          )}
                          {loanDetails.equipment_finance.business_use_pct > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Business Use</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.equipment_finance.business_use_pct}%</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* LEND mode: Business Loan */}
                    {loanDetails.business_loan && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Business Loan</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.business_loan.loan_purpose && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Purpose</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_loan.loan_purpose}</dd></div>
                          )}
                          {loanDetails.business_loan.purpose_type && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Purpose Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_loan.purpose_type}</dd></div>
                          )}
                          {loanDetails.business_loan.loan_amount > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Amount</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.business_loan.loan_amount).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.business_loan.loan_term && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Loan Term</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.business_loan.loan_term}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* LEND mode: Commercial Property */}
                    {loanDetails.commercial_property && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Commercial Property</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.commercial_property.purchase_or_refinance && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.commercial_property.purchase_or_refinance}</dd></div>
                          )}
                          {loanDetails.commercial_property.security_address && (
                            <div className="sm:col-span-2"><dt className="text-[12px] font-medium text-[var(--led-muted)]">Security Address</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.commercial_property.security_address}</dd></div>
                          )}
                          {loanDetails.commercial_property.estimated_value > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Estimated Value</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.commercial_property.estimated_value).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.commercial_property.existing_debt > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Existing Debt</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.commercial_property.existing_debt).toLocaleString()}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}

                    {/* LEND mode: Home Loan */}
                    {loanDetails.home_loan && (
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-4 space-y-3">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)]">Home Loan</p>
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {loanDetails.home_loan.purchase_or_refinance && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Type</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.home_loan.purchase_or_refinance}</dd></div>
                          )}
                          {loanDetails.home_loan.owner_or_investment && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Owner / Investment</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.home_loan.owner_or_investment}</dd></div>
                          )}
                          {loanDetails.home_loan.property_value > 0 && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Property Value</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(loanDetails.home_loan.property_value).toLocaleString()}</dd></div>
                          )}
                          {loanDetails.home_loan.existing_lender && (
                            <div><dt className="text-[12px] font-medium text-[var(--led-muted)]">Existing Lender</dt><dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{loanDetails.home_loan.existing_lender}</dd></div>
                          )}
                        </dl>
                      </div>
                    )}
                  </div>
                </div>
                </GlassCard>
              );
            } catch {
              return null;
            }
          })()}

          {/* Financial Position from lend_extra_data */}
          {application.lend_extra_data && (() => {
            try {
              const extraData = JSON.parse(application.lend_extra_data);

              // Identification: stored as array [{type, number, state/country, expiry_date}]
              const idEntry = Array.isArray(extraData.identification) ? extraData.identification[0] : null;
              const hasIdentification = idEntry && (idEntry.type || idEntry.number);

              // Employment: stored as array [{employer_name, employment_type, start_date, industry, job_title, contact_details}]
              const empEntry = Array.isArray(extraData.employments) ? extraData.employments[0] : null;
              const hasEmployment = empEntry && (empEntry.job_title || empEntry.employer_name);

              // Income: stored as array [{income_type, amount, frequency}]
              const incomes: Array<{income_type?: string; amount?: number; frequency?: string}> = Array.isArray(extraData.incomes) ? extraData.incomes.filter((i: {amount?: number}) => (i.amount ?? 0) > 0) : [];
              const hasIncome = incomes.length > 0;

              // Assets: stored as {real_estate: [...], other: [...]}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const realEstateAssets: Array<Record<string, any>> = Array.isArray(extraData.assets?.real_estate) ? extraData.assets.real_estate : [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const otherAssets: Array<Record<string, any>> = Array.isArray(extraData.assets?.other) ? extraData.assets.other : [];
              const hasAssets = realEstateAssets.length > 0 || otherAssets.length > 0;

              // Liabilities: stored as array [{liability_type, lender, balance, limit, monthly_repayment}]
              const liabs: Array<Record<string, unknown>> = Array.isArray(extraData.liabilities) ? extraData.liabilities : [];
              const hasLiabilities = liabs.length > 0;

              // Expenses: stored as {monthly_living, rent_mortgage, child_support, other_commitments}
              const expenses = extraData.expenses;
              const hasExpenses = expenses && (expenses.monthly_living > 0 || expenses.rent_mortgage > 0 || expenses.child_support > 0 || expenses.other_commitments > 0);

              const hasOtherDirectors = !!extraData.other_directors;

              if (!hasIdentification && !hasEmployment && !hasIncome && !hasAssets && !hasLiabilities && !hasExpenses && !hasOtherDirectors) return null;

              return (
                <GlassCard padding="none">
                  <div className="border-b border-[var(--led-line)] px-6 py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Finances</p>
                    <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Financial Position</h2>
                  </div>
                  <div className="p-6">

                  {/* Identification */}
                  {hasIdentification && (
                    <div className="mb-5">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Identification</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {idEntry.type && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">ID Type</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{idEntry.type}</dd>
                          </div>
                        )}
                        {idEntry.number && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">ID Number</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{idEntry.number}</dd>
                          </div>
                        )}
                        {(idEntry.state || idEntry.country) && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">{idEntry.state ? 'Issuing State' : 'Issuing Country'}</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{idEntry.state || idEntry.country}</dd>
                          </div>
                        )}
                        {idEntry.expiry_date && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Expiry Date</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{idEntry.expiry_date}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {/* Employment */}
                  {hasEmployment && (
                    <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Employment Details</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {empEntry.employer_name && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Employer</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{empEntry.employer_name}</dd>
                          </div>
                        )}
                        {empEntry.job_title && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Job Title</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{empEntry.job_title}</dd>
                          </div>
                        )}
                        {empEntry.employment_type && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Employment Type</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{empEntry.employment_type}</dd>
                          </div>
                        )}
                        {empEntry.start_date && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Start Date</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{empEntry.start_date}</dd>
                          </div>
                        )}
                        {empEntry.industry && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Industry</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{empEntry.industry}</dd>
                          </div>
                        )}
                        {empEntry.contact_details && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Employer Contact</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">{empEntry.contact_details}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {/* Other Directors */}
                  {hasOtherDirectors && (
                    <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Other Directors / Partners</h3>
                      <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                        <p className="text-[14px] font-medium text-[var(--led-ink)] whitespace-pre-wrap">{extraData.other_directors}</p>
                      </div>
                    </div>
                  )}

                  {/* Income */}
                  {hasIncome && (
                    <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Income</h3>
                      <div className="space-y-3">
                        {incomes.map((inc, idx) => (
                          <div key={idx} className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <p className="text-[12px] font-medium text-[var(--led-muted)] mb-1">{idx === 0 ? 'Primary Income' : `Additional Income ${idx}`}</p>
                            <div className="grid gap-2 sm:grid-cols-3">
                              {inc.income_type && <div><p className="text-[11px] text-[var(--led-muted)]">Type</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{inc.income_type}</p></div>}
                              {(inc.amount ?? 0) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Amount</p><p className="text-[14px] font-medium text-[var(--led-ink)]">${Number(inc.amount).toLocaleString()}</p></div>}
                              {inc.frequency && <div><p className="text-[11px] text-[var(--led-muted)]">Frequency</p><p className="text-[14px] font-medium text-[var(--led-ink)]">{inc.frequency}</p></div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expenses */}
                  {hasExpenses && (
                    <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Monthly Expenses</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {expenses.monthly_living > 0 && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Living Expenses</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(expenses.monthly_living).toLocaleString()}/mo</dd>
                          </div>
                        )}
                        {expenses.rent_mortgage > 0 && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Rent / Mortgage</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(expenses.rent_mortgage).toLocaleString()}/mo</dd>
                          </div>
                        )}
                        {expenses.child_support > 0 && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Child Support</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(expenses.child_support).toLocaleString()}/mo</dd>
                          </div>
                        )}
                        {expenses.other_commitments > 0 && (
                          <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">Other Commitments</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(expenses.other_commitments).toLocaleString()}/mo</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {/* Real Estate Assets */}
                  {realEstateAssets.length > 0 && (
                    <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Real Estate Assets</h3>
                      <div className="space-y-3">
                        {realEstateAssets.map((asset, idx) => (
                          <div key={idx} className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <p className="text-[13px] font-semibold text-[var(--led-ink)] mb-2">{String(asset.property_type || `Property ${idx + 1}`)}</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {asset.address && <div className="sm:col-span-2"><p className="text-[11px] text-[var(--led-muted)]">Address</p><p className="text-[13px] font-medium text-[var(--led-ink)]">{String(asset.address)}</p></div>}
                              {asset.ownership_type && <div><p className="text-[11px] text-[var(--led-muted)]">Ownership</p><p className="text-[13px] font-medium text-[var(--led-ink)]">{String(asset.ownership_type)}</p></div>}
                              {(asset.estimated_value as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Estimated Value</p><p className="text-[13px] font-medium text-[var(--led-ink)]">${Number(asset.estimated_value).toLocaleString()}</p></div>}
                              {asset.is_financed === 'yes' && asset.lender && <div><p className="text-[11px] text-[var(--led-muted)]">Lender</p><p className="text-[13px] font-medium text-[var(--led-ink)]">{String(asset.lender)}</p></div>}
                              {asset.is_financed === 'yes' && (asset.amount_owing as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Amount Owing</p><p className="text-[13px] font-medium text-[var(--led-ink)]">${Number(asset.amount_owing).toLocaleString()}</p></div>}
                              {asset.is_financed === 'yes' && (asset.monthly_repayment as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Monthly Repayment</p><p className="text-[13px] font-medium text-[var(--led-ink)]">${Number(asset.monthly_repayment).toLocaleString()}</p></div>}
                              {(asset.rental_income as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Rental Income</p><p className="text-[13px] font-medium text-[var(--led-ink)]">${Number(asset.rental_income).toLocaleString()}/mo</p></div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other Assets */}
                  {otherAssets.length > 0 && (
                    <div className="mb-5 pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Other Assets</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {otherAssets.map((asset, idx) => (
                          <div key={idx} className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <dt className="text-[12px] font-medium text-[var(--led-muted)]">{String(asset.asset_type || `Asset ${idx + 1}`)}</dt>
                            {(asset.value as number) > 0 && <dd className="mt-0.5 text-[14px] font-medium text-[var(--led-ink)]">${Number(asset.value).toLocaleString()}</dd>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Liabilities */}
                  {hasLiabilities && (
                    <div className="pt-4 border-t border-[var(--led-line)]">
                      <h3 className="text-[13px] font-medium text-[var(--led-muted)] mb-3">Liabilities</h3>
                      <div className="space-y-3">
                        {liabs.map((liability, index) => (
                          <div key={index} className="rounded-xl bg-[var(--led-surface-2)]/50 p-3">
                            <p className="text-[13px] font-semibold text-[var(--led-ink)] mb-1">{String(liability.liability_type ?? `Liability ${index + 1}`)}{liability.lender ? ` — ${liability.lender}` : ''}</p>
                            <div className="grid gap-2 sm:grid-cols-3 text-[13px]">
                              {(liability.balance as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Balance</p><p className="font-medium text-[var(--led-ink)]">${Number(liability.balance).toLocaleString()}</p></div>}
                              {(liability.limit as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Limit</p><p className="font-medium text-[var(--led-ink)]">${Number(liability.limit).toLocaleString()}</p></div>}
                              {(liability.monthly_repayment as number) > 0 && <div><p className="text-[11px] text-[var(--led-muted)]">Monthly</p><p className="font-medium text-[var(--led-ink)]">${Number(liability.monthly_repayment).toLocaleString()}</p></div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </GlassCard>
              );
            } catch {
              return null;
            }
          })()}

          </>
          )}

          {activeTab === 'documents' && (
          <>
          {/* Pending Document Requests */}
          {docRequests.some((r) => r.status === 'pending') && (
            <GlassCard className="border-warning/30 bg-[var(--led-warning)]/5">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--led-warning)]/15">
                  <svg className="h-4 w-4 text-[var(--led-warning)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--led-ink)]">Documents Requested</h2>
                  <p className="text-[13px] text-[var(--led-muted)] mt-0.5">Your broker has requested additional documents. Please upload them below and mark each request as fulfilled.</p>
                </div>
              </div>
              <div className="space-y-2">
                {docRequests.filter((r) => r.status === 'pending').map((req) => (
                  <div key={req.id} className="flex items-center gap-3 rounded-xl bg-[var(--led-surface)]/70 border border-warning/20 p-3.5">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--led-warning)]/20">
                      <svg className="h-3 w-3 text-[var(--led-warning)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    </div>
                    <p className="flex-1 text-[13px] text-[var(--led-ink)] font-medium">{req.description}</p>
                    <button
                      onClick={() => handleFulfillRequest(req.id)}
                      disabled={fulfillingRequestId === req.id}
                      className="shrink-0 led-btn led-btn-sm led-btn-outline disabled:opacity-50"
                    >
                      {fulfillingRequestId === req.id ? 'Saving...' : 'Mark Fulfilled'}
                    </button>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
          </> 
          )}

          {activeTab === 'messages' && (
          <>
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Chat</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Messages</h2>
            </div>
            <div className="p-6">
            <div className="flex flex-col gap-4">
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {clientMessages.length === 0 ? (
                  <div className="rounded-xl bg-[var(--led-surface-2)]/50 p-6 text-center">
                    <svg className="mx-auto h-8 w-8 text-[var(--led-muted)] mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                    <p className="text-[14px] text-[var(--led-muted)]">No messages yet</p>
                  </div>
                ) : (
                  clientMessages.map((msg) => {
                    const isOwn = msg.author_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[var(--led-ink)]">{isOwn ? 'You' : (msg.author_name || 'Staff')}</span>
                          <span className="text-[11px] text-[var(--led-muted)]">{formatDateTime(msg.created_at)}</span>
                        </div>
                        <div className={`rounded-2xl px-4 py-2.5 text-[14px] max-w-[85%] ${isOwn ? 'bg-[var(--led-accent)] text-[var(--led-accent-ink)]' : 'bg-[var(--led-surface-2)]/60 text-[var(--led-ink)]'}`}>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {(() => {
                const brokerRecipientId =
                  [...clientMessages].reverse().find((m) => m.author_id !== user?.id)?.author_id
                  ?? application?.assigned_brokers?.[0]?.id
                  ?? null;
                return (
              <div className="relative rounded-2xl bg-[var(--led-surface-2)]/40 border border-[var(--led-line)]/50 focus-within:border-primary/50 transition-all duration-300 flex flex-col pt-1">
                <textarea
                  value={newClientMsgContent}
                  onChange={(e) => setNewClientMsgContent(e.target.value)}
                  rows={2}
                  className="w-full bg-transparent px-4 py-3 text-[14px] text-[var(--led-ink)] focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
                  placeholder="Write a message to your broker..."
                />
                <div className="flex items-center justify-end px-3 pb-3 pt-1 border-t border-[var(--led-line)]/30 mt-1">
                  <Button
                    size="sm"
                    className="rounded-xl px-4 h-9"
                    loading={sendingClientMsg}
                    disabled={!newClientMsgContent.trim() || !user?.id || !brokerRecipientId}
                    onClick={async () => {
                      if (!user?.id || !newClientMsgContent.trim() || !brokerRecipientId) return;
                      setSendingClientMsg(true);
                      try {
                        const { data } = await api.post(`/clients/${user.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: brokerRecipientId });
                        setClientMessages((prev) => [...prev, data]);
                        setNewClientMsgContent('');
                        toast('Message sent', 'success');
                      } catch (err: unknown) {
                        toast(getErrorMessage(err, 'Failed to send'), 'error');
                      } finally {
                        setSendingClientMsg(false);
                      }
                    }}
                  >
                    <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                    Send
                  </Button>
                </div>
              </div>
                );
              })()}
            </div>
          </div>
          </GlassCard>
          </>
          )}

          {activeTab === 'overview' && (
          <>
          {/* Quote Sheets (sent by broker) */}
          {quoteSheets.length > 0 && (
            <GlassCard padding="none">
              <div className="border-b border-[var(--led-line)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Quotes</p>
                <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Quote Sheets</h2>
              </div>
              <div className="p-6">
              <div className="space-y-6">
                {[...quoteSheets].sort((a, b) => b.version - a.version).map(sheet => (
                  <div key={sheet.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-[var(--led-ink)]">v{sheet.version}</span>
                        {sheet.title && (
                          <span className="text-[13px] font-medium text-[var(--led-ink)]">{sheet.title}</span>
                        )}
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${QUOTE_SHEET_STATUS_BADGE[sheet.status].className}`}>
                          {QUOTE_SHEET_STATUS_BADGE[sheet.status].label}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDownloadPdf(sheet)}
                      >
                        <span className="flex items-center gap-1.5">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          Download PDF
                        </span>
                      </Button>
                    </div>
                    {sheet.sent_at && (
                      <p className="text-[11px] text-[var(--led-muted)]">Sent on {formatDate(sheet.sent_at)}</p>
                    )}
                    <QuoteSheetComparison quoteSheet={sheet} isClientView />
                  </div>
                ))}

                {/* On-demand off-screen render for clean PDF capture */}
                {pdfRenderSheet && (
                  <div style={{ position: 'fixed', left: '-9999px', top: 0, width: '794px', background: 'white', padding: '24px' }}>
                    <div id={`quote-sheet-pdf-${pdfRenderSheet.id}`}>
                      <QuoteSheetComparison
                        quoteSheet={pdfRenderSheet}
                        isClientView
                        isPdfExport={true}
                        clientName={`${application?.applicant_first_name || ''} ${application?.applicant_last_name || ''}`.trim() || 'Client'}
                        applicationRef={application?.id ? application.id.split('-')[0].toUpperCase() : undefined}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            </GlassCard>
          )}
          </>
          )}
        </div>

        {/* Upload Sidebar */}
        <div>
          <GlassCard padding="none">
            <div className="border-b border-[var(--led-line)] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">Upload</p>
              <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Upload Document</h2>
            </div>
            <div className="p-6">
            <DocumentUploader
              docType={docType as import('../../types').DocType}
              onDocTypeChange={(t) => {
                setDocType(t);
                setDocLabel(''); // Clear label when doc type changes
              }}
              uploading={uploading}
              onFile={handleUploadFile}
              fileLabel={docLabel}
              onFileLabelChange={setDocLabel}
              onError={(msg) => toast(msg, 'error')}
            />
          </div>
          </GlassCard>


        </div>
      </div>

      {/* Off-screen application PDF render */}
      {pdfRenderApp && (() => {
        let extraData: Record<string, unknown> = {};
        try { if (application.lend_extra_data) extraData = JSON.parse(application.lend_extra_data); } catch {}
        const loanDetails = extraData.loan_type_details as Record<string, unknown> | undefined;
        const idEntry = Array.isArray(extraData.identification) ? (extraData.identification as Array<Record<string, string>>)[0] : null;
        const empEntry = Array.isArray(extraData.employments) ? (extraData.employments as Array<Record<string, string>>)[0] : null;
        const incomes = Array.isArray(extraData.incomes) ? (extraData.incomes as Array<{income_type?: string; amount?: number; frequency?: string}>).filter(i => (i.amount ?? 0) > 0) : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const realEstateAssets: Array<Record<string, any>> = Array.isArray((extraData.assets as Record<string, unknown> | undefined)?.real_estate) ? (extraData.assets as Record<string, unknown[]>).real_estate as Array<Record<string, any>> : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const otherAssets: Array<Record<string, any>> = Array.isArray((extraData.assets as Record<string, unknown> | undefined)?.other) ? (extraData.assets as Record<string, unknown[]>).other as Array<Record<string, any>> : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const liabs: Array<Record<string, any>> = Array.isArray(extraData.liabilities) ? extraData.liabilities as Array<Record<string, any>> : [];
        const expenses = extraData.expenses as Record<string, number> | undefined;

        const S = { section: { marginBottom: '20px' } as React.CSSProperties, h2: { fontSize: '13px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px' }, grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } as React.CSSProperties, cell: { background: '#f9fafb', borderRadius: '8px', padding: '8px 10px' } as React.CSSProperties, label: { fontSize: '11px', color: '#9ca3af', fontWeight: 600 } as React.CSSProperties, value: { fontSize: '13px', color: '#111827', fontWeight: 500, marginTop: '2px' } as React.CSSProperties };

        return (
          <div style={{ position: 'fixed', left: '-9999px', top: 0, width: '794px', background: 'white', padding: '32px', fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
            <div id="application-pdf-render">
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', borderBottom: '2px solid #e5e7eb', paddingBottom: '16px' }}>
                <div>
                  <h1 style={{ fontSize: '20px', fontWeight: 700, textTransform: 'capitalize', marginBottom: '4px' }}>{application.loan_type.replace(/_/g, ' ')} Loan Application</h1>
                  {application.lend_ref && <p style={{ fontSize: '12px', color: '#6b7280' }}>Lend Ref: {application.lend_ref}</p>}
                  <p style={{ fontSize: '12px', color: '#6b7280' }}>Ref: {application.id.split('-')[0].toUpperCase()} · Submitted {formatDate(application.created_at)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Status</p>
                  <p style={{ fontSize: '13px', fontWeight: 700, textTransform: 'capitalize', color: '#111827' }}>{application.status.replace(/_/g, ' ')}</p>
                  <p style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>${Number(application.amount).toLocaleString()}</p>
                </div>
              </div>

              {/* Personal Details */}
              {application.applicant_first_name && (
                <div style={S.section}>
                  <h2 style={S.h2}>Applicant Details</h2>
                  <div style={S.grid}>
                    <div style={S.cell}><p style={S.label}>Full Name</p><p style={S.value}>{application.applicant_title} {application.applicant_first_name} {application.applicant_middle_name} {application.applicant_last_name}</p></div>
                    {application.applicant_dob && <div style={S.cell}><p style={S.label}>Date of Birth</p><p style={S.value}>{application.applicant_dob}</p></div>}
                    {application.applicant_gender && <div style={S.cell}><p style={S.label}>Gender</p><p style={S.value}>{application.applicant_gender}</p></div>}
                    {application.applicant_marital_status && <div style={S.cell}><p style={S.label}>Marital Status</p><p style={S.value}>{application.applicant_marital_status}</p></div>}
                    {application.applicant_mobile && <div style={S.cell}><p style={S.label}>Mobile</p><p style={S.value}>{application.applicant_mobile}</p></div>}
                    {application.user_email && <div style={S.cell}><p style={S.label}>Email</p><p style={S.value}>{application.user_email}</p></div>}
                    {application.preferred_contact_method && <div style={S.cell}><p style={S.label}>Preferred Contact</p><p style={S.value}>{application.preferred_contact_method}</p></div>}
                    {application.applicant_residency_status && <div style={S.cell}><p style={S.label}>Residency Status</p><p style={S.value}>{application.applicant_residency_status}</p></div>}
                    {idEntry?.type && <div style={S.cell}><p style={S.label}>ID Type</p><p style={S.value}>{idEntry.type}</p></div>}
                    {idEntry?.number && <div style={S.cell}><p style={S.label}>ID Number</p><p style={S.value}>{idEntry.number}</p></div>}
                    {(idEntry?.state || idEntry?.country) && <div style={S.cell}><p style={S.label}>{idEntry.state ? 'Issuing State' : 'Issuing Country'}</p><p style={S.value}>{idEntry.state || idEntry.country}</p></div>}
                    {(idEntry?.expiry_date || application.id_expiry_date) && <div style={S.cell}><p style={S.label}>ID Expiry</p><p style={S.value}>{idEntry?.expiry_date || application.id_expiry_date}</p></div>}
                  </div>
                </div>
              )}

              {/* Address */}
              {application.applicant_address && (
                <div style={S.section}>
                  <h2 style={S.h2}>Address & Living Situation</h2>
                  <div style={S.grid}>
                    <div style={{ ...S.cell, gridColumn: '1 / -1' }}><p style={S.label}>Address</p><p style={S.value}>{application.applicant_address}, {application.applicant_suburb} {application.applicant_state} {application.applicant_postcode}</p></div>
                    {application.residential_status && <div style={S.cell}><p style={S.label}>Residential Status</p><p style={S.value}>{application.residential_status}</p></div>}
                    {application.time_at_address && <div style={S.cell}><p style={S.label}>Time at Address</p><p style={S.value}>{application.time_at_address}</p></div>}
                    {application.applicant_num_dependants != null && <div style={S.cell}><p style={S.label}>Dependants</p><p style={S.value}>{application.applicant_num_dependants}</p></div>}
                    {application.has_partner != null && <div style={S.cell}><p style={S.label}>Has Partner</p><p style={S.value}>{application.has_partner ? 'Yes' : 'No'}</p></div>}
                    {application.partner_working != null && <div style={S.cell}><p style={S.label}>Partner Working</p><p style={S.value}>{application.partner_working ? 'Yes' : 'No'}</p></div>}
                  </div>
                </div>
              )}

              {/* Employment */}
              {(application.employment_category || empEntry) && (
                <div style={S.section}>
                  <h2 style={S.h2}>Employment</h2>
                  <div style={S.grid}>
                    {application.employment_category && <div style={S.cell}><p style={S.label}>Employment Type</p><p style={S.value}>{application.employment_category === 'self_employed' ? 'Self-Employed' : 'Employed'}</p></div>}
                    {(application.employer_name || empEntry?.employer_name) && <div style={S.cell}><p style={S.label}>Employer</p><p style={S.value}>{application.employer_name || empEntry?.employer_name}</p></div>}
                    {(application.job_title || empEntry?.job_title) && <div style={S.cell}><p style={S.label}>Job Title</p><p style={S.value}>{application.job_title || empEntry?.job_title}</p></div>}
                    {empEntry?.employment_type && <div style={S.cell}><p style={S.label}>Employment Type Detail</p><p style={S.value}>{empEntry.employment_type}</p></div>}
                    {empEntry?.start_date && <div style={S.cell}><p style={S.label}>Start Date</p><p style={S.value}>{empEntry.start_date}</p></div>}
                    {(application.employer_industry || empEntry?.industry) && <div style={S.cell}><p style={S.label}>Industry</p><p style={S.value}>{application.employer_industry || empEntry?.industry}</p></div>}
                    {application.income_frequency && <div style={S.cell}><p style={S.label}>Income Frequency</p><p style={S.value}>{application.income_frequency}</p></div>}
                    {application.gross_income && <div style={S.cell}><p style={S.label}>Gross Income</p><p style={S.value}>${Number(application.gross_income).toLocaleString()}</p></div>}
                    {empEntry?.contact_details && <div style={S.cell}><p style={S.label}>Employer Contact</p><p style={S.value}>{empEntry.contact_details}</p></div>}
                    {application.business_name && <div style={S.cell}><p style={S.label}>Business Name</p><p style={S.value}>{application.business_name}</p></div>}
                    {application.business_abn && <div style={S.cell}><p style={S.label}>ABN</p><p style={S.value}>{application.business_abn}</p></div>}
                    {application.trading_name && <div style={S.cell}><p style={S.label}>Trading Name</p><p style={S.value}>{application.trading_name}</p></div>}
                    {application.business_structure && <div style={S.cell}><p style={S.label}>Business Structure</p><p style={S.value}>{application.business_structure}</p></div>}
                    {application.time_trading && <div style={S.cell}><p style={S.label}>Time Trading</p><p style={S.value}>{application.time_trading}</p></div>}
                    {application.gst_registered != null && <div style={S.cell}><p style={S.label}>GST Registered</p><p style={S.value}>{application.gst_registered ? 'Yes' : 'No'}</p></div>}
                    {application.num_directors != null && <div style={S.cell}><p style={S.label}>No. of Directors</p><p style={S.value}>{application.num_directors}</p></div>}
                    {(extraData.other_directors as string | undefined) && <div style={{ ...S.cell, gridColumn: '1 / -1' }}><p style={S.label}>Other Directors / Partners</p><p style={S.value}>{String(extraData.other_directors)}</p></div>}
                  </div>
                </div>
              )}

              {/* Loan Type Details */}
              {loanDetails && Object.keys(loanDetails).length > 0 && (
                <div style={S.section}>
                  <h2 style={S.h2}>Loan Type Details</h2>
                  {Object.entries(loanDetails).map(([key, val]) => {
                    if (!val || typeof val !== 'object') return null;
                    const entries = Object.entries(val as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== false);
                    if (entries.length === 0) return null;
                    return (
                      <div key={key} style={{ marginBottom: '12px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</p>
                        <div style={S.grid}>
                          {entries.map(([k, v]) => (
                            <div key={k} style={S.cell}>
                              <p style={S.label}>{k.replace(/_/g, ' ')}</p>
                              <p style={S.value}>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' && k.includes('price') || k.includes('amount') || k.includes('value') || k.includes('cost') || k.includes('deposit') || k.includes('debt') ? `$${Number(v).toLocaleString()}` : String(v)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Income */}
              {incomes.length > 0 && (
                <div style={S.section}>
                  <h2 style={S.h2}>Income</h2>
                  <div style={S.grid}>
                    {incomes.map((inc, idx) => (
                      <div key={idx} style={S.cell}>
                        <p style={S.label}>{idx === 0 ? 'Primary Income' : `Additional Income ${idx}`}</p>
                        <p style={S.value}>{inc.income_type}{inc.amount ? ` — $${Number(inc.amount).toLocaleString()}` : ''}{inc.frequency ? ` / ${inc.frequency}` : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Expenses */}
              {expenses && (expenses.monthly_living > 0 || expenses.rent_mortgage > 0 || expenses.child_support > 0 || expenses.other_commitments > 0) && (
                <div style={S.section}>
                  <h2 style={S.h2}>Monthly Expenses</h2>
                  <div style={S.grid}>
                    {expenses.monthly_living > 0 && <div style={S.cell}><p style={S.label}>Living Expenses</p><p style={S.value}>${Number(expenses.monthly_living).toLocaleString()}/mo</p></div>}
                    {expenses.rent_mortgage > 0 && <div style={S.cell}><p style={S.label}>Rent / Mortgage</p><p style={S.value}>${Number(expenses.rent_mortgage).toLocaleString()}/mo</p></div>}
                    {expenses.child_support > 0 && <div style={S.cell}><p style={S.label}>Child Support</p><p style={S.value}>${Number(expenses.child_support).toLocaleString()}/mo</p></div>}
                    {expenses.other_commitments > 0 && <div style={S.cell}><p style={S.label}>Other Commitments</p><p style={S.value}>${Number(expenses.other_commitments).toLocaleString()}/mo</p></div>}
                  </div>
                </div>
              )}

              {/* Real Estate Assets */}
              {realEstateAssets.length > 0 && (
                <div style={S.section}>
                  <h2 style={S.h2}>Real Estate Assets</h2>
                  {realEstateAssets.map((asset, idx) => (
                    <div key={idx} style={{ ...S.cell, marginBottom: '8px' }}>
                      <p style={{ ...S.label, marginBottom: '4px' }}>{String(asset.property_type || `Property ${idx + 1}`)}</p>
                      {asset.address && <p style={S.value}>{String(asset.address)}</p>}
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' as const, marginTop: '4px' }}>
                        {(asset.estimated_value as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Value: ${Number(asset.estimated_value).toLocaleString()}</span>}
                        {asset.ownership_type && <span style={{ fontSize: '12px', color: '#374151' }}>Ownership: {String(asset.ownership_type)}</span>}
                        {asset.is_financed === 'yes' && asset.lender && <span style={{ fontSize: '12px', color: '#374151' }}>Lender: {String(asset.lender)}</span>}
                        {asset.is_financed === 'yes' && (asset.amount_owing as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Owing: ${Number(asset.amount_owing).toLocaleString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Other Assets */}
              {otherAssets.length > 0 && (
                <div style={S.section}>
                  <h2 style={S.h2}>Other Assets</h2>
                  <div style={S.grid}>
                    {otherAssets.map((asset, idx) => (
                      <div key={idx} style={S.cell}>
                        <p style={S.label}>{String(asset.asset_type || `Asset ${idx + 1}`)}</p>
                        {(asset.value as number) > 0 && <p style={S.value}>${Number(asset.value).toLocaleString()}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Liabilities */}
              {liabs.length > 0 && (
                <div style={S.section}>
                  <h2 style={S.h2}>Liabilities</h2>
                  {liabs.map((lib, idx) => (
                    <div key={idx} style={{ ...S.cell, marginBottom: '8px' }}>
                      <p style={{ ...S.label, marginBottom: '4px' }}>{String(lib.liability_type || `Liability ${idx + 1}`)}{lib.lender ? ` — ${lib.lender}` : ''}</p>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' as const }}>
                        {(lib.balance as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Balance: ${Number(lib.balance).toLocaleString()}</span>}
                        {(lib.limit as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Limit: ${Number(lib.limit).toLocaleString()}</span>}
                        {(lib.monthly_repayment as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Monthly: ${Number(lib.monthly_repayment).toLocaleString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Declarations */}
              {(application.previously_declined != null || application.change_of_circumstances != null || application.signature_name || application.emergency_contact_name) && (
                <div style={S.section}>
                  <h2 style={S.h2}>Declarations</h2>
                  <div style={S.grid}>
                    {application.previously_declined != null && <div style={S.cell}><p style={S.label}>Previously Declined</p><p style={S.value}>{application.previously_declined ? 'Yes' : 'No'}</p></div>}
                    {application.change_of_circumstances != null && <div style={S.cell}><p style={S.label}>Change of Circumstances</p><p style={S.value}>{application.change_of_circumstances ? 'Yes' : 'No'}</p></div>}
                    {application.emergency_contact_name && <div style={S.cell}><p style={S.label}>Emergency Contact</p><p style={S.value}>{application.emergency_contact_name}{application.emergency_contact_relationship ? ` (${application.emergency_contact_relationship})` : ''}{application.emergency_contact_phone ? ` · ${application.emergency_contact_phone}` : ''}</p></div>}
                    {application.signature_name && <div style={S.cell}><p style={S.label}>Digital Signature</p><p style={S.value}>{application.signature_name}</p></div>}
                  </div>
                </div>
              )}

              {/* Notes */}
              {application.notes && (
                <div style={S.section}>
                  <h2 style={S.h2}>Notes</h2>
                  <div style={S.cell}><p style={{ fontSize: '13px', color: '#374151' }}>{application.notes}</p></div>
                </div>
              )}

              {/* Documents */}
              {documents.length > 0 && (
                <div style={S.section}>
                  <h2 style={S.h2}>Submitted Documents ({documents.length})</h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        <th style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>Document Type</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>Filename</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>Uploaded</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>Verified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc, idx) => (
                        <tr key={doc.id} style={{ background: idx % 2 === 0 ? 'white' : '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '6px 10px', color: '#374151', fontWeight: 500 }}>{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</td>
                          <td style={{ padding: '6px 10px', color: '#374151', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.original_filename}</td>
                          <td style={{ padding: '6px 10px', color: '#6b7280' }}>{formatDate(doc.uploaded_at)}</td>
                          <td style={{ padding: '6px 10px', color: doc.is_verified ? '#16a34a' : '#9ca3af', fontWeight: 600 }}>{doc.is_verified ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '24px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
                Generated {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} · Xpress Tech Portal
              </p>
            </div>
          </div>
        );
      })()}

      {previewDoc && (
        <DocumentPreviewModal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          documentId={previewDoc.id}
          filename={previewDoc.filename}
          ocrStatus={previewDoc.ocrStatus}
          showOcrTab={false}
        />
      )}

      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
            onClick={() => !deletingApp && setShowDeleteConfirm(false)}
          />
          <div
            className="relative w-full max-w-[400px] rounded-2xl bg-[var(--led-surface)] border border-[var(--led-line)] p-6 shadow-xl"
            style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--led-danger)]/10">
              <svg className="h-6 w-6 text-[var(--led-danger)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </div>
            <h3 className="text-center text-[17px] font-semibold text-[var(--led-ink)] mb-1">
              Delete draft application?
            </h3>
            <p className="text-center text-[14px] text-[var(--led-muted)] mb-6">
              This will permanently delete this {application?.loan_type} loan application
              {documents.length > 0 && ` and ${documents.length} uploaded document${documents.length > 1 ? 's' : ''}`}.
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingApp}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="lg"
                className="flex-1"
                onClick={handleDeleteApplication}
                loading={deletingApp}
              >
                {deletingApp ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={showSubmitConfirm}
        title="Submit application for review?"
        message="This will change the application status to Application Received."
        confirmText="Submit"
        cancelText="Cancel"
        variant="primary"
        loading={submittingApplication}
        onConfirm={handleSubmitApplication}
        onCancel={() => {
          if (!submittingApplication) setShowSubmitConfirm(false);
        }}
      />
    </div>
  );
}
