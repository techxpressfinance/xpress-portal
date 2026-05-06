import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import DocumentUploader from '../../components/DocumentUploader';
import QuoteSheetComparison from '../../components/QuoteSheetComparison';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, Badge, Button, ConfirmDialog } from '../../components/ui';
import { useFileDownload } from '../../hooks/useFileDownload';
import { ACTION_ICON_CONFIG, ACTION_LABELS, DOC_TYPE_LABELS, LEND_SYNC_BADGE, OCR_STATUS_BADGE, QUOTE_SHEET_STATUS_BADGE, RECOMMENDED_DOC_TYPES } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import { useAuth } from '../../hooks/useAuth';
import type { ActivityLog, ClientMessage, Document, DocumentRequest, LendSyncStatus, LoanApplication, QuoteSheet } from '../../types';

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { downloadFile } = useFileDownload();
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [newClientMsgContent, setNewClientMsgContent] = useState('');
  const [sendingClientMsg, setSendingClientMsg] = useState(false);
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
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [fulfillingRequestId, setFulfillingRequestId] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

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
    api.get(`/activity-logs/application/${id}`)
      .then(({ data }) => setActivityLogs(data))
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, [id]);

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/clients/${user.id}/messages`)
      .then(({ data }) => setClientMessages(data))
      .catch(() => { });
  }, [user?.id]);

  const handleUploadFile = async (file: File) => {
    if (!id) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const { data } = await api.post(`/documents/upload/${id}?doc_type=${docType}`, formData);
      setDocuments((prev) => [...prev, data]);
      toast('Document uploaded successfully', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
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

          {/* Referrer Info */}
          {application.referrer && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Referred By</h2>
              <div className="flex items-center gap-4 rounded-xl bg-secondary/50 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-foreground">{application.referrer.full_name || '—'}</p>
                  {application.referrer.organization_name && (
                    <p className="text-[12px] text-muted-foreground">{application.referrer.organization_name}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {application.referrer.email && (
                      <a href={`mailto:${application.referrer.email}`} className="text-[13px] text-primary hover:underline">{application.referrer.email}</a>
                    )}
                    {application.referrer.phone && (
                      <span className="text-[13px] text-muted-foreground">{application.referrer.phone}</span>
                    )}
                  </div>
                </div>
              </div>
              {application.client_engagement_model && (
                <div className="mt-3 rounded-xl bg-secondary/30 p-3">
                  <p className="text-[12px] text-muted-foreground">
                    {application.client_engagement_model === 'self_managed'
                      ? 'Your referrer will manage the client relationship.'
                      : 'The broker may engage you directly.'}
                  </p>
                </div>
              )}
            </GlassCard>
          )}

          {/* Pending Document Requests */}
          {docRequests.some((r) => r.status === 'pending') && (
            <GlassCard className="border-warning/30 bg-warning/5">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning/15">
                  <svg className="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-foreground">Documents Requested</h2>
                  <p className="text-[13px] text-muted-foreground mt-0.5">Your broker has requested additional documents. Please upload them below and mark each request as fulfilled.</p>
                </div>
              </div>
              <div className="space-y-2">
                {docRequests.filter((r) => r.status === 'pending').map((req) => (
                  <div key={req.id} className="flex items-center gap-3 rounded-xl bg-background/70 border border-warning/20 p-3.5">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/20">
                      <svg className="h-3 w-3 text-warning" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    </div>
                    <p className="flex-1 text-[13px] text-foreground font-medium">{req.description}</p>
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
              
              {/* Personal Information */}
              <div className="mb-5">
                <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Personal Information</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-secondary/50 p-3">
                    <dt className="text-[12px] font-medium text-muted-foreground">Full Name</dt>
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
                  {application.applicant_gender && (
                    <div className="rounded-xl bg-secondary/50 p-3">
                      <dt className="text-[12px] font-medium text-muted-foreground">Gender</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_gender}</dd>
                    </div>
                  )}
                  {application.applicant_marital_status && (
                    <div className="rounded-xl bg-secondary/50 p-3">
                      <dt className="text-[12px] font-medium text-muted-foreground">Marital Status</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_marital_status}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Contact Information */}
              {(application.applicant_mobile || application.preferred_contact_method) && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Contact Information</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.applicant_mobile && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Mobile Phone</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_mobile}</dd>
                      </div>
                    )}
                    {application.preferred_contact_method && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Preferred Contact Method</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.preferred_contact_method}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Address */}
              {application.applicant_address && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Address</h3>
                  <div className="rounded-xl bg-secondary/50 p-3 mb-3">
                    <dt className="text-[12px] font-medium text-muted-foreground">Street Address</dt>
                    <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                      {application.applicant_address}, {application.applicant_suburb} {application.applicant_state} {application.applicant_postcode}
                    </dd>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.residential_status && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Residential Status</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.residential_status}</dd>
                      </div>
                    )}
                    {application.time_at_address && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Time at Address</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.time_at_address}</dd>
                      </div>
                    )}
                    {application.applicant_num_dependants !== null && application.applicant_num_dependants !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Number of Dependants</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_num_dependants}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Living Situation */}
              {(application.has_partner !== null || application.partner_working !== null || application.applicant_residency_status || application.id_expiry_date) && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Living Situation</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.has_partner !== null && application.has_partner !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Has Partner</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.has_partner ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.partner_working !== null && application.partner_working !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Partner Working</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.partner_working ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.applicant_residency_status && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Residency Status</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_residency_status}</dd>
                      </div>
                    )}
                    {application.id_expiry_date && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">ID Expiry Date</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.id_expiry_date}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Employment Information */}
              {(application.employment_category || application.employer_name || application.job_title || application.gross_income) && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Employment Information</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.employment_category && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Employment Category</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.employment_category}</dd>
                      </div>
                    )}
                    {application.employer_name && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Employer Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.employer_name}</dd>
                      </div>
                    )}
                    {application.employer_industry && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Employer Industry</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.employer_industry}</dd>
                      </div>
                    )}
                    {application.job_title && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Job Title</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.job_title}</dd>
                      </div>
                    )}
                    {application.income_frequency && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Income Frequency</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.income_frequency}</dd>
                      </div>
                    )}
                    {application.gross_income && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Gross Income</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">${Number(application.gross_income).toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Business Information */}
              {(application.business_name || application.business_abn || application.trading_name || application.business_structure) && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Business Information</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.business_name && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Business Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_name}</dd>
                      </div>
                    )}
                    {application.trading_name && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Trading Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.trading_name}</dd>
                      </div>
                    )}
                    {application.business_abn && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">ABN</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_abn}</dd>
                      </div>
                    )}
                    {application.business_structure && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Business Structure</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_structure}</dd>
                      </div>
                    )}
                    {application.business_registration_date && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Registration Date</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_registration_date}</dd>
                      </div>
                    )}
                    {application.time_trading && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Time Trading</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.time_trading}</dd>
                      </div>
                    )}
                    {application.gst_registered !== null && application.gst_registered !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">GST Registered</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.gst_registered ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.num_directors !== null && application.num_directors !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Number of Directors</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.num_directors}</dd>
                      </div>
                    )}
                    {application.business_monthly_sales && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Monthly Sales</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">${Number(application.business_monthly_sales).toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Loan Details */}
              {(application.loan_term_requested || application.loan_purpose_id) && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Loan Details</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.loan_term_requested && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Loan Term</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.loan_term_requested} months</dd>
                      </div>
                    )}
                    {application.loan_purpose_id && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Loan Purpose ID</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.loan_purpose_id}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Emergency Contact */}
              {application.emergency_contact_name && (
                <div className="mb-5 pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Emergency Contact</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-secondary/50 p-3">
                      <dt className="text-[12px] font-medium text-muted-foreground">Name</dt>
                      <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_name}</dd>
                    </div>
                    {application.emergency_contact_relationship && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Relationship</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_relationship}</dd>
                      </div>
                    )}
                    {application.emergency_contact_phone && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Phone</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_phone}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Declarations */}
              {(application.previously_declined !== null || application.change_of_circumstances !== null || application.signature_name) && (
                <div className="pt-4 border-t border-border">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Declarations</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {application.previously_declined !== null && application.previously_declined !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Previously Declined</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.previously_declined ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.change_of_circumstances !== null && application.change_of_circumstances !== undefined && (
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Change of Circumstances</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.change_of_circumstances ? 'Yes' : 'No'}</dd>
                      </div>
                    )}
                    {application.signature_name && (
                      <div className="rounded-xl bg-secondary/50 p-3 sm:col-span-2">
                        <dt className="text-[12px] font-medium text-muted-foreground">Signature Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.signature_name}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </GlassCard>
          )}

          {/* Additional Data from lend_extra_data */}
          {application.lend_extra_data && (() => {
            try {
              const extraData = JSON.parse(application.lend_extra_data);
              const hasIdentification = extraData.identification && (extraData.identification.id_type || extraData.identification.id_number);
              const hasEmployment = extraData.employment && (extraData.employment.occupation || extraData.employment.employer_name);
              const hasIncome = extraData.income && (extraData.income.source || extraData.income.amount);
              const hasAssets = extraData.assets && (Array.isArray(extraData.assets) ? extraData.assets.length > 0 : Object.keys(extraData.assets).length > 0);
              const hasLiabilities = extraData.liabilities && (Array.isArray(extraData.liabilities) ? extraData.liabilities.length > 0 : Object.keys(extraData.liabilities).length > 0);
              
              if (!hasIdentification && !hasEmployment && !hasIncome && !hasAssets && !hasLiabilities) return null;

              return (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Additional Information</h2>
                  
                  {/* Identification */}
                  {hasIdentification && (
                    <div className="mb-5">
                      <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Identification</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {extraData.identification.id_type && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">ID Type</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.identification.id_type}</dd>
                          </div>
                        )}
                        {extraData.identification.id_number && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">ID Number</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.identification.id_number}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {/* Employment */}
                  {hasEmployment && (
                    <div className="mb-5 pt-4 border-t border-border">
                      <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Employment Details</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {extraData.employment.occupation && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Occupation</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.employment.occupation}</dd>
                          </div>
                        )}
                        {extraData.employment.employer_name && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Employer</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.employment.employer_name}</dd>
                          </div>
                        )}
                        {extraData.employment.employment_type && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Employment Type</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.employment.employment_type}</dd>
                          </div>
                        )}
                        {extraData.employment.length_of_employment && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Length of Employment</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.employment.length_of_employment}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {/* Income */}
                  {hasIncome && (
                    <div className="mb-5 pt-4 border-t border-border">
                      <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Income Details</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {extraData.income.source && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Income Source</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.income.source}</dd>
                          </div>
                        )}
                        {extraData.income.amount && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Amount</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">${Number(extraData.income.amount).toLocaleString()}</dd>
                          </div>
                        )}
                        {extraData.income.frequency && (
                          <div className="rounded-xl bg-secondary/50 p-3">
                            <dt className="text-[12px] font-medium text-muted-foreground">Frequency</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{extraData.income.frequency}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {/* Assets */}
                  {hasAssets && (
                    <div className="mb-5 pt-4 border-t border-border">
                      <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Assets</h3>
                      {Array.isArray(extraData.assets) ? (
                        <div className="space-y-3">
                          {extraData.assets.map((asset: Record<string, unknown>, index: number) => {
                            const description = String(asset.description ?? asset.type ?? `Asset ${index + 1}`);
                            const value = asset.value ? Number(asset.value) : null;
                            return (
                              <div key={index} className="rounded-xl bg-secondary/50 p-3">
                                <p className="text-[14px] font-medium text-foreground">{description}</p>
                                {value !== null && value > 0 && <p className="text-[13px] text-muted-foreground">${value.toLocaleString()}</p>}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {Object.entries(extraData.assets).map(([key, value]) => (
                            <div key={key} className="rounded-xl bg-secondary/50 p-3">
                              <dt className="text-[12px] font-medium text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</dt>
                              <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                                {typeof value === 'number' ? `$${value.toLocaleString()}` : String(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}

                  {/* Liabilities */}
                  {hasLiabilities && (
                    <div className="pt-4 border-t border-border">
                      <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Liabilities</h3>
                      {Array.isArray(extraData.liabilities) ? (
                        <div className="space-y-3">
                          {extraData.liabilities.map((liability: Record<string, unknown>, index: number) => {
                            const description = String(liability.description ?? liability.type ?? `Liability ${index + 1}`);
                            const balance = liability.balance ? Number(liability.balance) : null;
                            const monthlyPayment = liability.monthly_payment ? Number(liability.monthly_payment) : null;
                            return (
                              <div key={index} className="rounded-xl bg-secondary/50 p-3">
                                <p className="text-[14px] font-medium text-foreground">{description}</p>
                                {balance !== null && balance > 0 && <p className="text-[13px] text-muted-foreground">Balance: ${balance.toLocaleString()}</p>}
                                {monthlyPayment !== null && monthlyPayment > 0 && <p className="text-[13px] text-muted-foreground">Monthly: ${monthlyPayment.toLocaleString()}</p>}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {Object.entries(extraData.liabilities).map(([key, value]) => (
                            <div key={key} className="rounded-xl bg-secondary/50 p-3">
                              <dt className="text-[12px] font-medium text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</dt>
                              <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                                {typeof value === 'number' ? `$${value.toLocaleString()}` : String(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}
                </GlassCard>
              );
            } catch {
              return null;
            }
          })()}

          {/* Messages */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-5">Messages</h2>
            <div className="flex flex-col gap-4">
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {clientMessages.length === 0 ? (
                  <div className="rounded-xl bg-secondary/50 p-6 text-center">
                    <svg className="mx-auto h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                    <p className="text-[14px] text-muted-foreground">No messages yet</p>
                  </div>
                ) : (
                  clientMessages.map((msg) => {
                    const isOwn = msg.author_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || 'Staff')}</span>
                          <span className="text-[11px] text-muted-foreground">{formatDate(msg.created_at)} {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className={`rounded-2xl px-4 py-2.5 text-[14px] max-w-[85%] ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-foreground'}`}>
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
              <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-primary/50 transition-all duration-300 flex flex-col pt-1">
                <textarea
                  value={newClientMsgContent}
                  onChange={(e) => setNewClientMsgContent(e.target.value)}
                  rows={2}
                  className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
                  placeholder="Write a message to your broker..."
                />
                <div className="flex items-center justify-end px-3 pb-3 pt-1 border-t border-border/30 mt-1">
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
            <DocumentUploader
              docType={docType as import('../../types').DocType}
              onDocTypeChange={(t) => setDocType(t)}
              uploading={uploading}
              onFile={handleUploadFile}
              onError={(msg) => toast(msg, 'error')}
            />
          </GlassCard>

          {/* Activity */}
          <GlassCard padding="none">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-[15px] font-semibold text-foreground">Activity</h2>
              <p className="text-[13px] text-muted-foreground mt-0.5">History of actions on this application</p>
            </div>
            {activityLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl shimmer shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-40 rounded-lg shimmer" />
                      <div className="h-3 w-52 rounded-lg shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activityLogs.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                  <svg className="h-7 w-7 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
                <p className="text-[14px] text-muted-foreground font-medium">No activity yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {activityLogs.map(log => {
                  let details: Record<string, string> = {};
                  try { if (log.details) details = JSON.parse(log.details); } catch {}
                  let description = '';
                  if (log.action === 'status_changed' && details.from && details.to) {
                    description = `${details.from} → ${details.to}`;
                  } else if ((log.action === 'broker_assigned' || log.action === 'broker_unassigned') && details.broker_name) {
                    description = details.broker_name;
                  } else if (log.action === 'document_verified' && details.filename) {
                    description = `${details.filename}${details.doc_type ? ` (${details.doc_type})` : ''}`;
                  } else if (log.action === 'created' && details.loan_type) {
                    description = `${details.loan_type} loan · $${Number(details.amount || 0).toLocaleString()}`;
                  }
                  const actionConfig = ACTION_ICON_CONFIG[log.action];
                  return (
                    <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-secondary/50 transition-colors">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${actionConfig?.bg || 'bg-secondary text-muted-foreground'}`}>
                        {actionConfig?.icon || (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[13.5px] font-semibold text-foreground">{ACTION_LABELS[log.action] || log.action}</span>
                          {log.user_name && (
                            <span className="text-[12.5px] text-muted-foreground">by <span className="font-medium text-foreground">{log.user_name}</span></span>
                          )}
                        </div>
                        {description && <p className="text-[12.5px] text-muted-foreground">{description}</p>}
                      </div>
                      <span className="text-[12px] text-muted-foreground whitespace-nowrap pt-0.5">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
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
