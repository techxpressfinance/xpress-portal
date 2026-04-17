import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import QuoteSheetComparison from '../../components/QuoteSheetComparison';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, Badge, Button, ConfirmDialog } from '../../components/ui';
import { useFileDownload } from '../../hooks/useFileDownload';
import { DOC_TYPE_LABELS, LEND_SYNC_BADGE, OCR_STATUS_BADGE, QUOTE_SHEET_STATUS_BADGE, RECOMMENDED_DOC_TYPES } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import type { ApplicationNote, Document, LendSyncStatus, LoanApplication, QuoteSheet } from '../../types';

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { downloadFile } = useFileDownload();
  const fileInput = useRef<HTMLInputElement>(null);

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [appNotes, setAppNotes] = useState<ApplicationNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [docType, setDocType] = useState('id_proof');
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);
  const [deletingApp, setDeletingApp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [quoteSheets, setQuoteSheets] = useState<QuoteSheet[]>([]);
  const [pdfRenderSheet, setPdfRenderSheet] = useState<QuoteSheet | null>(null);

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
      api.get(`/applications/${id}/notes`),
    ])
      .then(([appRes, docRes, notesRes]) => {
        setApplication(appRes.data);
        setDocuments(docRes.data);
        setAppNotes(notesRes.data);
      })
      .catch(() => toast('Failed to load application', 'error'))
      .finally(() => setLoading(false));
    // Fetch sent quote sheets (backend filters to sent-only for clients)
    api.get(`/applications/${id}/quote-sheets`).then(({ data }) => setQuoteSheets(data)).catch(() => { });
  }, [id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      toast('File size exceeds 10MB limit', 'error');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data } = await api.post(
        `/documents/upload/${id}?doc_type=${docType}`,
        formData,
      );
      setDocuments((prev) => [...prev, data]);
      toast('Document uploaded successfully', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleDelete = async (docId: string) => {
    setDeletingId(docId);
    try {
      await api.delete(`/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      toast('Document deleted', 'success');
    } catch (err: any) {
      console.error('Delete error:', err);
      toast(getErrorMessage(err, 'Failed to delete document'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (docId: string, filename: string) => downloadFile(docId, filename);

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
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-4">
          <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
        </div>
        <p className="text-[15px] text-muted-foreground font-medium">Application not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link
          to="/applications"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors duration-200"
          style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          Back to Applications
        </Link>
      </div>

      {/* Status Timeline */}
      <GlassCard className="mb-6">
        <h2 className="text-[13px] font-medium text-muted-foreground mb-4">Application Progress</h2>
        <StatusTimeline currentStatus={application.status} />
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Application Info */}
        <div className="lg:col-span-2 space-y-6">
          <GlassCard>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-[20px] font-semibold text-foreground capitalize">
                {application.loan_type} Loan Application
              </h1>
              <div className="flex items-center gap-2">
                <Badge value={application.status} />
                {application.lend_sync_status && LEND_SYNC_BADGE[application.lend_sync_status as LendSyncStatus] && (
                  <Badge type="custom" value={LEND_SYNC_BADGE[application.lend_sync_status as LendSyncStatus].label} className={LEND_SYNC_BADGE[application.lend_sync_status as LendSyncStatus].className} />
                )}
              </div>
            </div>
            {application.lend_ref && (
              <div className="mb-4 rounded-xl bg-success/5 border border-success/20 px-4 py-2.5">
                <span className="text-[13px] font-medium text-success">Lend Ref: {application.lend_ref}</span>
              </div>
            )}
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-secondary/50 p-4">
                <dt className="text-[13px] font-medium text-muted-foreground">Amount</dt>
                <dd className="mt-1 text-[20px] font-semibold text-foreground">
                  ${Number(application.amount).toLocaleString()}
                </dd>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <dt className="text-[13px] font-medium text-muted-foreground">Loan Type</dt>
                <dd className="mt-1 text-[20px] font-semibold text-foreground capitalize">{application.loan_type}</dd>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <dt className="text-[13px] font-medium text-muted-foreground">Created</dt>
                <dd className="mt-1 text-[15px] font-semibold text-foreground">
                  {formatDate(application.created_at)}
                </dd>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <dt className="text-[13px] font-medium text-muted-foreground">Last Updated</dt>
                <dd className="mt-1 text-[15px] font-semibold text-foreground">
                  {formatDate(application.updated_at)}
                </dd>
              </div>
            </dl>
            {application.notes && (
              <div className="mt-5 rounded-xl bg-secondary/50 p-4">
                <dt className="text-[13px] font-medium text-muted-foreground mb-1">Notes</dt>
                <dd className="text-[14px] text-foreground">{application.notes}</dd>
              </div>
            )}

            {application.status === 'draft' && (
              <div className="mt-6 pt-5 border-t border-border">
                <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Recommended Documents</h3>
                <div className="grid gap-2 sm:grid-cols-2 mb-4">
                  {RECOMMENDED_DOC_TYPES.map((type) => (
                    <div key={type} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] transition-all duration-200 ${uploadedDocTypes.has(type) ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'}`}>
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
                  <p className="text-[12px] text-muted-foreground mb-3">You can submit now — missing documents may be requested during review.</p>
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
          </GlassCard>

          {/* Documents */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-5">Documents</h2>
            {documents.length === 0 ? (
              <div className="rounded-xl bg-secondary/50 p-6 text-center">
                <svg className="mx-auto h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                <p className="text-[14px] text-muted-foreground">No documents uploaded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 rounded-xl bg-secondary/30 p-4 transition-all duration-200 hover:bg-secondary/50"
                    style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-foreground">{doc.original_filename}</p>
                      <p className="text-[13px] text-muted-foreground">
                        {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type} &middot;{' '}
                        {formatDate(doc.uploaded_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {doc.ocr_status && (
                        <Badge type="custom" value={OCR_STATUS_BADGE[doc.ocr_status].label} className={OCR_STATUS_BADGE[doc.ocr_status].className} />
                      )}
                      {doc.is_verified ? (
                        <Badge type="custom" value="Verified" className="bg-success/10 text-success" />
                      ) : (
                        <Badge type="custom" value="Pending" className="bg-chart-4/10 text-chart-4" />
                      )}
                      <button
                        onClick={() => setPreviewDoc({ id: doc.id, filename: doc.original_filename, ocrStatus: doc.ocr_status })}
                        className="led-btn led-btn-outline led-btn-sm"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDownload(doc.id, doc.original_filename)}
                        className="hidden sm:inline-block led-btn led-btn-outline led-btn-sm"
                      >
                        Download
                      </button>
                      {application.status === 'draft' && (
                        <button
                          onClick={() => handleDelete(doc.id)}
                          disabled={deletingId === doc.id}
                          className="led-btn led-btn-danger led-btn-sm"
                        >
                          {deletingId === doc.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Applicant Details */}
          {application.applicant_first_name && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Applicant Details</h2>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/50 p-3">
                  <dt className="text-[12px] font-medium text-muted-foreground">Name</dt>
                  <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                    {application.applicant_title} {application.applicant_first_name} {application.applicant_middle_name} {application.applicant_last_name}
                  </dd>
                </div>
                {application.applicant_dob && (
                  <div className="rounded-xl bg-secondary/50 p-3">
                    <dt className="text-[12px] font-medium text-muted-foreground">Date of Birth</dt>
                    <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_dob}</dd>
                  </div>
                )}
                {application.applicant_address && (
                  <div className="rounded-xl bg-secondary/50 p-3 sm:col-span-2">
                    <dt className="text-[12px] font-medium text-muted-foreground">Address</dt>
                    <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                      {application.applicant_address}, {application.applicant_suburb} {application.applicant_state} {application.applicant_postcode}
                    </dd>
                  </div>
                )}
                {application.business_name && (
                  <>
                    <div className="rounded-xl bg-secondary/50 p-3">
                      <dt className="text-[12px] font-medium text-muted-foreground">Business</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_name}</dd>
                    </div>
                    {application.business_abn && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">ABN</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_abn}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </GlassCard>
          )}

          {/* Messages from Team */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-5">Messages from Team</h2>
            {appNotes.length === 0 ? (
              <div className="rounded-xl bg-secondary/50 p-6 text-center">
                <svg className="mx-auto h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                <p className="text-[14px] text-muted-foreground">No messages yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appNotes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-xl bg-secondary/30 p-4 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[13px] font-semibold text-foreground">{note.author_name || 'Staff'}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {formatDate(note.created_at)} {new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[14px] text-foreground whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Quote Sheets (sent by broker) */}
          {quoteSheets.length > 0 && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Quote Sheets</h2>
              <div className="space-y-6">
                {[...quoteSheets].sort((a, b) => b.version - a.version).map(sheet => (
                  <div key={sheet.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-foreground">v{sheet.version}</span>
                        {sheet.title && (
                          <span className="text-[13px] font-medium text-foreground">{sheet.title}</span>
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
                      <p className="text-[11px] text-muted-foreground">Sent on {formatDate(sheet.sent_at)}</p>
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
            </GlassCard>
          )}
        </div>

        {/* Upload Sidebar */}
        <div>
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-4">Upload Document</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                  Document Type
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="led-input"
                >
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="relative">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleUpload}
                    disabled={uploading}
                    className="w-full text-[13px] text-muted-foreground file:mr-4 file:rounded-xl file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-primary hover:file:bg-primary/20 file:transition-colors file:cursor-pointer"
                  />
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">PDF, JPG, PNG (max 10MB)</p>
              </div>
              {uploading && (
                <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-3">
                  <svg className="h-4 w-4 animate-spin text-primary" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  <span className="text-[13px] font-medium text-primary">Uploading...</span>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

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
            className="relative w-full max-w-[400px] rounded-2xl bg-background border border-border p-6 shadow-xl"
            style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </div>
            <h3 className="text-center text-[17px] font-semibold text-foreground mb-1">
              Delete draft application?
            </h3>
            <p className="text-center text-[14px] text-muted-foreground mb-6">
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
