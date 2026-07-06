import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../api/client';
import DirectorsSection from '../../components/DirectorsSection';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import DocumentUploader from '../../components/DocumentUploader';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { useFileDownload } from '../../hooks/useFileDownload';
import { useTabParam } from '../../hooks/useTabParam';
import { GlassCard, Badge, Button, ConfirmDialog, Breadcrumbs, DatePicker } from '../../components/ui';
import { getErrorMessage, formatDate, formatTime, formatDateTime, getInitials } from '../../lib/utils';
import { DOC_TYPE_LABELS, LOAN_CATEGORIES, OCR_STATUS_BADGE, RECOMMENDED_DOC_TYPES, LOAN_TYPE_LABELS, categoryForSubType, findLoanSubType } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import type { ClientMessage, DocType, Document, DocumentRequest, LoanApplication, LoanType, User } from '../../types';

export default function ReferrerApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { downloadFile } = useFileDownload();
  const fileInput = useRef<HTMLInputElement>(null);

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [client, setClient] = useState<User | null>(null);
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabParam('overview', ['overview', 'details', 'documents', 'messages'] as const);

  const [downloadingAppPdf, setDownloadingAppPdf] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Document upload
  const [docType, setDocType] = useState<DocType>('id_proof');
  const [fileLabel, setFileLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [retryingOcr, setRetryingOcr] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);

  // Submit on behalf
  const [confirmBrokerSubmit, setConfirmBrokerSubmit] = useState(false);
  const [submittingOnBehalf, setSubmittingOnBehalf] = useState(false);

  // Client messages
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [newClientMsgContent, setNewClientMsgContent] = useState('');
  const [sendingClientMsg, setSendingClientMsg] = useState(false);
  // Doc requests
  const [showDocRequestForm, setShowDocRequestForm] = useState(false);
  const [docRequestItems, setDocRequestItems] = useState<string[]>(['']);
  const [submittingDocRequest, setSubmittingDocRequest] = useState(false);
  // Edit mode
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);

  // Delete document
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Delete application (for drafts)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingApp, setDeletingApp] = useState(false);
  const EDIT_DEFAULTS = {
    loan_type: 'personal' as LoanType, notes: '',
    amount: '', applicant_title: '', applicant_first_name: '', applicant_last_name: '',
    applicant_middle_name: '', applicant_dob: '', applicant_gender: '', applicant_marital_status: '',
    applicant_address: '', applicant_suburb: '', applicant_state: '', applicant_postcode: '',
    business_name: '', business_abn: '',
    // Extended details
    applicant_email: '', applicant_mobile: '', preferred_contact_method: '',
    id_expiry_date: '', applicant_residency_status: '',
    residential_status: '', time_at_address: '', applicant_num_dependants: '',
    has_partner: false, partner_working: false,
    employment_category: '', employer_name: '', employer_industry: '', job_title: '',
    income_frequency: '', gross_income: '',
    trading_name: '', business_structure: '', gst_registered: false, num_directors: '', time_trading: '',
    previously_declined: false, change_of_circumstances: '',
    signature_name: '', emergency_contact_name: '', emergency_contact_relationship: '',
    emergency_contact_phone: '',
  };
  const { register: regEdit, reset: resetEdit, handleSubmit: handleEditSubmit, watch: watchEdit, setValue: setValueEdit, formState: { errors: editErrors } } = useForm({ defaultValues: EDIT_DEFAULTS });

  // Check if referrer is handling the client (self-managed mode)
  const isSelfManaged = application?.client_engagement_model === 'self_managed';

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/applications/${id}`),
      api.get(`/documents/application/${id}`),
      api.get(`/documents/requests/${id}`),
    ])
      .then(([appRes, docRes, reqRes]) => {
        const d = appRes.data;
        setApplication(d);
        setDocuments(docRes.data);
        setDocRequests(reqRes.data);
        resetEdit({
          loan_type: d.loan_type || 'personal', notes: d.notes || '',
          amount: d.amount ? String(d.amount) : '',
          applicant_title: d.applicant_title || '', applicant_first_name: d.applicant_first_name || '',
          applicant_last_name: d.applicant_last_name || '', applicant_middle_name: d.applicant_middle_name || '',
          applicant_dob: d.applicant_dob || '', applicant_gender: d.applicant_gender || '',
          applicant_marital_status: d.applicant_marital_status || '',
          applicant_address: d.applicant_address || '', applicant_suburb: d.applicant_suburb || '',
          applicant_state: d.applicant_state || '', applicant_postcode: d.applicant_postcode || '',
          business_name: d.business_name || '', business_abn: d.business_abn || '',
          applicant_email: d.applicant_email || '', applicant_mobile: d.applicant_mobile || '',
          preferred_contact_method: d.preferred_contact_method || '',
          id_expiry_date: d.id_expiry_date || '', applicant_residency_status: d.applicant_residency_status || '',
          residential_status: d.residential_status || '', time_at_address: d.time_at_address || '',
          applicant_num_dependants: d.applicant_num_dependants != null ? String(d.applicant_num_dependants) : '',
          has_partner: d.has_partner || false, partner_working: d.partner_working || false,
          employment_category: d.employment_category || '', employer_name: d.employer_name || '',
          employer_industry: d.employer_industry || '', job_title: d.job_title || '',
          income_frequency: d.income_frequency || '', gross_income: d.gross_income != null ? String(d.gross_income) : '',
          trading_name: d.trading_name || '', business_structure: d.business_structure || '',
          gst_registered: d.gst_registered || false,
          num_directors: d.num_directors != null ? String(d.num_directors) : '', time_trading: d.time_trading || '',
          previously_declined: d.previously_declined || false, change_of_circumstances: d.change_of_circumstances || '',
          signature_name: d.signature_name || '', emergency_contact_name: d.emergency_contact_name || '',
          emergency_contact_relationship: d.emergency_contact_relationship || '',
          emergency_contact_phone: d.emergency_contact_phone || '',
        });
        if (d.user_id && d.user_id !== currentUser?.id) {
          api.get(`/users/${d.user_id}`).then(({ data }) => setClient(data)).catch(() => { });
        }
        if (d.assigned_brokers?.length > 0 && currentUser?.id) {
          api.get(`/clients/${currentUser.id}/messages`, { params: { peer_id: d.assigned_brokers[0].id, application_id: id } })
            .then(({ data }) => setClientMessages(data)).catch(() => { });
        }
      })
      .catch(() => toast('Failed to load application', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleUploadFile = async (file: File) => {
    if (!id) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams({ doc_type: docType });
    if (fileLabel.trim()) params.set('label', fileLabel.trim());
    try {
      const { data } = await api.post(`/documents/upload/${id}?${params}`, formData);
      setDocuments((prev) => [...prev, data]);
      setFileLabel('');
      toast('Document uploaded', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { await handleUploadFile(file); e.target.value = ''; }
  };

  const handleRetryOcr = async (docId: string) => {
    setRetryingOcr(docId);
    try {
      await api.post(`/documents/${docId}/retry-ocr`);
      setDocuments((prev) => prev.map((d) => d.id === docId ? { ...d, ocr_status: 'pending' as const } : d));
      toast('OCR restarted', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to restart OCR'), 'error');
    } finally {
      setRetryingOcr(null);
    }
  };

  const handleVerifyDoc = async (docId: string) => {
    try {
      const { data } = await api.patch(`/documents/${docId}/verify`);
      setDocuments((prev) => prev.map((d) => (d.id === docId ? data : d)));
      toast('Document verified', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to verify'), 'error');
    }
  };

  const handleBrokerSubmit = async () => {
    if (!id) return;
    setSubmittingOnBehalf(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, { status: 'application_received' });
      setApplication(data);
      toast('Application submitted on behalf of client', 'success');
      setConfirmBrokerSubmit(false);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to submit'), 'error');
    } finally {
      setSubmittingOnBehalf(false);
    }
  };

  const handleSaveEdit = async (fields: typeof EDIT_DEFAULTS) => {
    if (!id) return;
    setSavingEdit(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, {
        loan_type: fields.loan_type,
        amount: fields.amount ? parseFloat(fields.amount) : undefined,
        notes: fields.notes || null,
        applicant_title: fields.applicant_title || null,
        applicant_first_name: fields.applicant_first_name || null,
        applicant_last_name: fields.applicant_last_name || null,
        applicant_middle_name: fields.applicant_middle_name || null,
        applicant_dob: fields.applicant_dob || null,
        applicant_gender: fields.applicant_gender || null,
        applicant_marital_status: fields.applicant_marital_status || null,
        applicant_address: fields.applicant_address || null,
        applicant_suburb: fields.applicant_suburb || null,
        applicant_state: fields.applicant_state || null,
        applicant_postcode: fields.applicant_postcode || null,
        business_name: fields.business_name || null,
        business_abn: fields.business_abn || null,
      });
      setApplication(data);
      setEditing(false);
      toast('Application updated', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save changes'), 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveDetails = async (fields: typeof EDIT_DEFAULTS) => {
    if (!id) return;
    setSavingDetails(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, {
        applicant_email: fields.applicant_email || null,
        applicant_mobile: fields.applicant_mobile || null,
        preferred_contact_method: fields.preferred_contact_method || null,
        id_expiry_date: fields.id_expiry_date || null,
        applicant_residency_status: fields.applicant_residency_status || null,
        residential_status: fields.residential_status || null,
        time_at_address: fields.time_at_address || null,
        applicant_num_dependants: fields.applicant_num_dependants ? parseInt(fields.applicant_num_dependants) : null,
        has_partner: fields.has_partner,
        partner_working: fields.partner_working,
        employment_category: fields.employment_category || null,
        employer_name: fields.employer_name || null,
        employer_industry: fields.employer_industry || null,
        job_title: fields.job_title || null,
        income_frequency: fields.income_frequency || null,
        gross_income: fields.gross_income ? parseFloat(fields.gross_income) : null,
        trading_name: fields.trading_name || null,
        business_structure: fields.business_structure || null,
        gst_registered: fields.gst_registered,
        num_directors: fields.num_directors ? parseInt(fields.num_directors) : null,
        time_trading: fields.time_trading || null,
        previously_declined: fields.previously_declined,
        change_of_circumstances: fields.change_of_circumstances || null,
        signature_name: fields.signature_name || null,
        emergency_contact_name: fields.emergency_contact_name || null,
        emergency_contact_relationship: fields.emergency_contact_relationship || null,
        emergency_contact_phone: fields.emergency_contact_phone || null,
      });
      setApplication(data);
      toast('Details saved', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save details'), 'error');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleSubmitDocRequest = async () => {
    if (!id) return;
    const items = docRequestItems.map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    setSubmittingDocRequest(true);
    try {
      const { data } = await api.post(`/documents/requests/${id}`, { items });
      setDocRequests((prev) => [...prev, ...data]);
      setDocRequestItems(['']);
      setShowDocRequestForm(false);
      toast(`Requested ${items.length} document${items.length !== 1 ? 's' : ''} from client`, 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send request'), 'error');
    } finally {
      setSubmittingDocRequest(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    setDeletingId(docId);
    try {
      await api.delete(`/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      toast('Document deleted', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete document'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (!id) return;
    setDownloadingAll(true);
    let url: string | null = null;
    let a: HTMLAnchorElement | null = null;
    try {
      const { data } = await api.get(`/documents/application/${id}/download-all`, { responseType: 'blob' });
      url = URL.createObjectURL(data);
      a = document.createElement('a');
      a.href = url;
      a.download = `application-${id.slice(0, 8)}-documents.zip`;
      document.body.appendChild(a);
      a.click();
    } catch {
      toast('Failed to download documents', 'error');
    } finally {
      if (a?.parentNode) document.body.removeChild(a);
      if (url) URL.revokeObjectURL(url);
      setDownloadingAll(false);
    }
  };

  const handleDeleteApplication = async () => {
    if (!id) return;
    setDeletingApp(true);
    try {
      await api.delete(`/applications/${id}`);
      toast('Application deleted', 'success');
      navigate('/referrer/applications');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete application'), 'error');
      setDeletingApp(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDownloadAppPdf = async () => {
    if (!application) return;
    setDownloadingAppPdf(true);
    try {
      const filename = `application-${application.id.split('-')[0].toUpperCase()}.pdf`;
      await downloadQuoteSheetPdf('application-pdf-render', filename);
    } catch {
      toast('Failed to generate PDF', 'error');
    } finally {
      setDownloadingAppPdf(false);
    }
  };

  const uploadedDocTypes = new Set(documents.map((d) => d.doc_type));
  const missingDocs = RECOMMENDED_DOC_TYPES.filter((t) => !uploadedDocTypes.has(t));
  const allDocsUploaded = missingDocs.length === 0;

  // Broker-selected sections the client may complete (JSON array of section keys).
  // null/absent = all sections visible. A referrer must not see or edit anything
  // beyond what the broker exposed to the client — mirrors the client view's gating.
  const enabledSections: Set<string> | null = (() => {
    if (!application?.client_sections) return null;
    try {
      const parsed = JSON.parse(application.client_sections);
      return Array.isArray(parsed)
        ? new Set(parsed.filter((s: unknown): s is string => typeof s === 'string'))
        : null;
    } catch {
      return null;
    }
  })();
  const sectionVisible = (...keys: string[]) =>
    !enabledSections || keys.some((k) => enabledSections.has(k));

  // Client-style view for self-managed mode
  if (isSelfManaged) {
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
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/referrer/applications"
            className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors duration-200"
            style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
            Back to Applications
          </Link>
          <Button variant="secondary" size="sm" onClick={handleDownloadAppPdf} loading={downloadingAppPdf} disabled={downloadingAppPdf}>
            <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Download PDF
          </Button>
        </div>

        {/* Status Timeline */}
        <GlassCard className="mb-6">
          <h2 className="text-[13px] font-medium text-muted-foreground mb-4">Application Progress</h2>
          <StatusTimeline currentStatus={application.status} />
        </GlassCard>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content - Client Style */}
          <div className="lg:col-span-2 space-y-6">
            {/* Application Info */}
            <GlassCard>
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-[20px] font-semibold text-foreground capitalize">
                  {application.loan_type} Loan Application
                </h1>
                <div className="flex items-center gap-2">
                  <Badge value={application.status} />
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
                    ${Number(application.amount).toLocaleString('en-AU')}
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
                      onClick={() => setConfirmBrokerSubmit(true)}
                      loading={submittingOnBehalf}
                      disabled={submittingOnBehalf}
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

            {/* Personal Details */}
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Personal Details</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/50 p-3.5 sm:col-span-2">
                  <p className="text-[12px] text-muted-foreground">Full Name</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">
                    {[application.applicant_title, application.applicant_first_name, application.applicant_middle_name, application.applicant_last_name].filter(Boolean).join(' ') || '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Date of Birth</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_dob || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Gender</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground capitalize">{application.applicant_gender || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Marital Status</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground capitalize">{application.applicant_marital_status || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Dependants</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_num_dependants ?? '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Mobile</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_mobile || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Preferred Contact</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground capitalize">{application.preferred_contact_method || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Residency Status</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_residency_status || '—'}</p>
                </div>
              </div>
            </GlassCard>

            {/* Address & Living Situation */}
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Address & Living Situation</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/50 p-3.5 sm:col-span-2">
                  <p className="text-[12px] text-muted-foreground">Address</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">
                    {[application.applicant_address, application.applicant_suburb, application.applicant_state, application.applicant_postcode].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Residential Status</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground capitalize">{application.residential_status || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Time at Address</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.time_at_address || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Has Partner</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.has_partner != null ? (application.has_partner ? 'Yes' : 'No') : '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Partner Working</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.partner_working != null ? (application.partner_working ? 'Yes' : 'No') : '—'}</p>
                </div>
              </div>
            </GlassCard>

            {/* Employment */}
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Employment</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/50 p-3.5 sm:col-span-2">
                  <p className="text-[12px] text-muted-foreground">Employment Type</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground capitalize">{application.employment_category || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Employer</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.employer_name || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Job Title</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.job_title || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Industry</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.employer_industry || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Gross Income</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">
                    {application.gross_income != null ? `$${Number(application.gross_income).toLocaleString('en-AU')}${application.income_frequency ? ` / ${application.income_frequency}` : ''}` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Business Name</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_name || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Trading Name</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.trading_name || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">ABN</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_abn || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Business Structure</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_structure || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Time Trading</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.time_trading || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">GST Registered</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.gst_registered != null ? (application.gst_registered ? 'Yes' : 'No') : '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Number of Directors</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.num_directors ?? '—'}</p>
                </div>
              </div>
            </GlassCard>

            {/* Directors (commercial loans, read-only) */}
            {['business', 'business_loan', 'commercial_property', 'equipment_finance'].includes(application.loan_type) && (
              <GlassCard>
                <DirectorsSection application={application} onChange={() => {}} />
              </GlassCard>
            )}

            {/* Emergency Contact */}
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Emergency Contact</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Name</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_name || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Relationship</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_relationship || '—'}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 p-3.5">
                  <p className="text-[12px] text-muted-foreground">Phone</p>
                  <p className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_phone || '—'}</p>
                </div>
              </div>
            </GlassCard>

            {/* Documents */}
            <GlassCard>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[15px] font-semibold text-foreground">Documents</h2>
                {documents.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={handleDownloadAll} loading={downloadingAll}>
                    <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Download All
                  </Button>
                )}
              </div>
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
                          onClick={() => downloadFile(doc.id, doc.original_filename)}
                          className="hidden sm:inline-block led-btn led-btn-outline led-btn-sm"
                        >
                          Download
                        </button>
                        {application.status === 'draft' && (
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
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
                      const isOwn = msg.author_id === currentUser?.id;
                      return (
                        <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || 'Staff')}</span>
                            <span className="text-[11px] text-muted-foreground">{formatDateTime(msg.created_at)}</span>
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
                    [...clientMessages].reverse().find((m) => m.author_id !== currentUser?.id)?.author_id
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
                          disabled={!newClientMsgContent.trim() || !currentUser?.id || !brokerRecipientId}
                          onClick={async () => {
                            if (!currentUser?.id || !newClientMsgContent.trim() || !brokerRecipientId) return;
                            setSendingClientMsg(true);
                            try {
                              const { data } = await api.post(`/clients/${currentUser.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: brokerRecipientId, application_id: id });
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
          </div>

          {/* Sidebar - Upload */}
          <div>
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-4">Upload Document</h2>
              <DocumentUploader
                docType={docType as import('../../types').DocType}
                onDocTypeChange={(t) => {
                  setDocType(t);
                  setFileLabel('');
                }}
                uploading={uploading}
                onFile={handleUploadFile}
                fileLabel={fileLabel}
                onFileLabelChange={setFileLabel}
                onError={(msg) => toast(msg, 'error')}
              />
            </GlassCard>

            {/* Assigned Brokers */}
            {application.assigned_brokers.length > 0 && (
              <GlassCard className="mt-6">
                <h2 className="text-[15px] font-semibold text-foreground mb-4">Assigned Brokers</h2>
                <div className="space-y-2">
                  {application.assigned_brokers.map((ab) => (
                    <div key={ab.id} className="flex items-center gap-3 rounded-xl bg-primary/10 p-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                        <span className="text-[11px] font-semibold text-primary-foreground">{getInitials(ab.full_name)}</span>
                      </div>
                      <p className="text-[13px] font-semibold text-primary flex-1">{ab.full_name}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}
          </div>
        </div>

        {/* Delete Confirm Modal */}
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

        {/* Submit Confirm Dialog */}
        <ConfirmDialog
          open={confirmBrokerSubmit}
          title="Submit application for review?"
          message="This will change the application status to Application Received."
          confirmText="Submit"
          cancelText="Cancel"
          variant="primary"
          loading={submittingOnBehalf}
          onConfirm={handleBrokerSubmit}
          onCancel={() => {
            if (!submittingOnBehalf) setConfirmBrokerSubmit(false);
          }}
        />

        {/* Preview Modal */}
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
      </div>
    );
  }

  // Original loading and not found for non-self-managed mode
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-6 w-full max-w-5xl">
          <div className="h-8 w-48 rounded-lg shimmer" />
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
        <p className="text-[14px] text-muted-foreground font-medium">Application not found</p>
        <Link to="/referrer/applications" className="mt-3 text-[13px] text-primary font-medium hover:underline">Back to Applications</Link>
      </div>
    );
  }

  const isDraft = application.status === 'draft';
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Breadcrumbs items={[
          { label: 'Applications', href: '/referrer/applications' },
          { label: application ? `APP-${application.id.replace(/-/g, '').slice(-6).toUpperCase()}` : 'Detail' },
        ]} />
      </div>

      {/* Status Timeline */}
      <GlassCard className="mb-6">
        <h2 className="text-[13px] font-medium text-muted-foreground mb-4">Application Progress</h2>
        <StatusTimeline currentStatus={application.status} />
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0 border-b border-border/60 mb-6 scrollbar-none">
            {([
              { key: 'overview', label: 'Overview' },
              { key: 'details', label: 'Full Details' },
              { key: 'documents', label: 'Documents' },
              { key: 'messages', label: 'Messages' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`whitespace-nowrap px-4 py-3 text-[14px] font-semibold transition-all duration-300 relative ${activeTab === key ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-t-lg'}`}
              >
                {label}
                {activeTab === key && (
                  <div className="absolute bottom-[-1px] left-0 w-full h-[2px] bg-primary rounded-t-full" />
                )}
              </button>
            ))}
          </div>

          <div className="space-y-6 animate-in fade-in duration-300">

            {/* ── OVERVIEW ── */}
            {activeTab === 'overview' && (
              <>
                {/* Completion banner */}
                {application.completed_by_name && (
                  <div className="rounded-2xl bg-primary/10 border border-primary/20 p-4 flex items-center gap-3">
                    <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                    <p className="text-[13px] font-medium text-primary">
                      Completed by {application.completed_by_name} on {formatDate(application.completed_at!)}
                    </p>
                  </div>
                )}

                {/* Application info */}
                <GlassCard>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                    <h1 className="text-[20px] sm:text-[28px] font-semibold text-foreground capitalize tracking-tight">
                      {application.loan_type} Loan
                    </h1>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge value={application.status} />
                      {!editing && (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                            Edit
                          </span>
                        </Button>
                      )}
                      {editing && <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>}
                    </div>
                  </div>

                  {editing ? (
                    <div className="space-y-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-[13px] font-medium text-muted-foreground mb-2">Loan Type</label>
                          <select {...regEdit('loan_type')} className="led-input">
                            {Object.entries(LOAN_TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[13px] font-medium text-muted-foreground mb-2">Amount ($)</label>
                          <input type="number" step="0.01" placeholder="Enter amount" className="led-input"
                            {...regEdit('amount', { validate: v => !v || parseFloat(v) > 0 || 'Must be greater than 0' })} />
                          {editErrors.amount && <p className="text-[12px] text-destructive mt-1">{editErrors.amount.message}</p>}
                        </div>
                      </div>

                      {sectionVisible('personal') && (<>
                      <h3 className="text-[13px] font-medium text-muted-foreground">Applicant</h3>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Title</label>
                          <select {...regEdit('applicant_title')} className="led-input">
                            <option value="">Select...</option>
                            {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'].map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">First Name</label>
                          <input type="text" className="led-input"
                            {...regEdit('applicant_first_name', { required: 'Required' })} />
                          {editErrors.applicant_first_name && <p className="text-[12px] text-destructive mt-1">{editErrors.applicant_first_name.message}</p>}
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Middle Name</label>
                          <input type="text" className="led-input" {...regEdit('applicant_middle_name')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Last Name</label>
                          <input type="text" className="led-input"
                            {...regEdit('applicant_last_name', { required: 'Required' })} />
                          {editErrors.applicant_last_name && <p className="text-[12px] text-destructive mt-1">{editErrors.applicant_last_name.message}</p>}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <DatePicker
                            label="DOB"
                            value={watchEdit('applicant_dob') || ''}
                            onChange={(v) => setValueEdit('applicant_dob', v, { shouldValidate: true })}
                            className="led-input"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Gender</label>
                          <select {...regEdit('applicant_gender')} className="led-input">
                            <option value="">Select...</option>
                            {['Male', 'Female', 'Other'].map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Marital Status</label>
                          <select {...regEdit('applicant_marital_status')} className="led-input">
                            <option value="">Select...</option>
                            {['Single', 'Married', 'De Facto', 'Separated', 'Divorced', 'Widowed'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      </>)}

                      {sectionVisible('living') && (<>
                      <h3 className="text-[13px] font-medium text-muted-foreground">Address</h3>
                      <div>
                        <label className="block text-[12px] text-muted-foreground mb-1">Street Address</label>
                        <input type="text" className="led-input" {...regEdit('applicant_address')} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Suburb</label>
                          <input type="text" className="led-input" {...regEdit('applicant_suburb')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">State</label>
                          <select {...regEdit('applicant_state')} className="led-input">
                            <option value="">Select...</option>
                            {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Postcode</label>
                          <input type="text" className="led-input"
                            {...regEdit('applicant_postcode', { pattern: { value: /^\d{4}$/, message: 'Invalid postcode' } })} />
                          {editErrors.applicant_postcode && <p className="text-[12px] text-destructive mt-1">{editErrors.applicant_postcode.message}</p>}
                        </div>
                      </div>

                      </>)}

                      {sectionVisible('business') && (watchEdit('loan_type') === 'business' || watchEdit('business_name') || watchEdit('business_abn')) && (
                        <>
                          <h3 className="text-[13px] font-medium text-muted-foreground">Business</h3>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">Business Name</label>
                              <input type="text" className="led-input" {...regEdit('business_name')} />
                            </div>
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">ABN</label>
                              <input type="text" className="led-input" {...regEdit('business_abn')} />
                            </div>
                          </div>
                        </>
                      )}

                      <div>
                        <label className="block text-[13px] font-medium text-muted-foreground mb-2">Notes</label>
                        <textarea rows={3} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground" placeholder="Application notes..." {...regEdit('notes')} />
                      </div>

                      <div className="flex items-center gap-3">
                        <Button onClick={handleEditSubmit(handleSaveEdit)} loading={savingEdit}>Save Changes</Button>
                        <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl bg-secondary p-4">
                        <dt className="text-[13px] font-medium text-muted-foreground">Amount</dt>
                        <dd className="mt-1 text-[28px] font-semibold text-foreground tracking-tight">${Number(application.amount).toLocaleString('en-AU')}</dd>
                      </div>
                      <div className="rounded-xl bg-secondary p-4">
                        <dt className="text-[13px] font-medium text-muted-foreground">Loan Type</dt>
                        <dd className="mt-1 text-[28px] font-semibold text-foreground tracking-tight">{LOAN_TYPE_LABELS[application.loan_type] || application.loan_type}</dd>
                      </div>
                      <div className="rounded-xl bg-secondary p-4">
                        <dt className="text-[13px] font-medium text-muted-foreground">Created</dt>
                        <dd className="mt-1 text-[14px] font-semibold text-foreground">{formatDate(application.created_at)}</dd>
                      </div>
                      <div className="rounded-xl bg-secondary p-4">
                        <dt className="text-[13px] font-medium text-muted-foreground">Last Updated</dt>
                        <dd className="mt-1 text-[14px] font-semibold text-foreground">{formatDate(application.updated_at)}</dd>
                      </div>
                    </dl>
                  )}
                </GlassCard>

                {/* Client Info */}
                {(() => {
                  const isDirectLead = application.user_id === currentUser?.id;
                  const displayName = isDirectLead
                    ? [application.applicant_first_name, application.applicant_last_name].filter(Boolean).join(' ')
                    : client?.full_name;
                  const displayEmail = isDirectLead
                    ? (() => { try { return JSON.parse(application.lend_extra_data || '{}').applicant_email; } catch { return null; } })()
                    : client?.email;
                  const displayPhone = isDirectLead ? application.applicant_mobile : client?.phone;
                  if (!displayName) return null;
                  return (
                    <GlassCard>
                      <h2 className="text-[15px] font-semibold text-foreground mb-5">Client Information</h2>
                      <div className="flex items-center gap-4 mb-5">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
                          <span className="text-[15px] font-semibold text-primary-foreground">{displayName.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="text-[14px] font-semibold text-foreground">{displayName}</p>
                          {displayEmail && <p className="text-[13px] text-muted-foreground">{displayEmail}</p>}
                        </div>
                      </div>
                      <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <dt className="text-[13px] font-medium text-muted-foreground">Phone</dt>
                          <dd className="mt-1 text-[14px] font-medium text-foreground">{displayPhone || 'Not provided'}</dd>
                        </div>
                      </dl>
                    </GlassCard>
                  );
                })()}

                {/* Applicant Summary */}
                {application.applicant_first_name && sectionVisible('personal', 'living', 'business') && (
                  <GlassCard>
                    <h2 className="text-[15px] font-semibold text-foreground mb-5">Applicant Details</h2>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                          {application.applicant_title} {application.applicant_first_name} {application.applicant_middle_name} {application.applicant_last_name}
                        </dd>
                      </div>
                      {sectionVisible('personal') && application.applicant_dob && (
                        <div className="rounded-xl bg-secondary/50 p-3">
                          <dt className="text-[12px] font-medium text-muted-foreground">Date of Birth</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_dob}</dd>
                        </div>
                      )}
                      {sectionVisible('personal') && application.applicant_gender && (
                        <div className="rounded-xl bg-secondary/50 p-3">
                          <dt className="text-[12px] font-medium text-muted-foreground">Gender</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_gender}</dd>
                        </div>
                      )}
                      {sectionVisible('personal') && application.applicant_marital_status && (
                        <div className="rounded-xl bg-secondary/50 p-3">
                          <dt className="text-[12px] font-medium text-muted-foreground">Marital Status</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_marital_status}</dd>
                        </div>
                      )}
                      {sectionVisible('living') && application.applicant_address && (
                        <div className="rounded-xl bg-secondary/50 p-3 sm:col-span-2">
                          <dt className="text-[12px] font-medium text-muted-foreground">Address</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                            {application.applicant_address}, {application.applicant_suburb} {application.applicant_state} {application.applicant_postcode}
                          </dd>
                        </div>
                      )}
                      {sectionVisible('business') && application.business_name && (
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
              </>
            )}

            {/* ── FULL DETAILS ── */}
            {activeTab === 'details' && (
              <div className="space-y-6">
                {/* Contact */}
                {sectionVisible('contact') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Contact Details</h2>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Email</label>
                        <input type="email" className="led-input" placeholder="client@email.com" {...regEdit('applicant_email')} />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Mobile</label>
                        <input type="text" className="led-input" placeholder="04XX XXX XXX" {...regEdit('applicant_mobile')} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Preferred Contact Method</label>
                      <select {...regEdit('preferred_contact_method')} className="led-input">
                        <option value="">Select...</option>
                        {['Phone', 'Email', 'SMS'].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                </GlassCard>
                )}

                {/* Identification */}
                {sectionVisible('identification') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Identification</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <DatePicker
                        label="ID Expiry Date"
                        value={watchEdit('id_expiry_date') || ''}
                        onChange={(v) => setValueEdit('id_expiry_date', v, { shouldValidate: true })}
                        className="led-input"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Residency Status</label>
                      <select {...regEdit('applicant_residency_status')} className="led-input">
                        <option value="">Select...</option>
                        {['Australian Citizen', 'Permanent Resident', 'Temporary Resident', 'Non-Resident'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </GlassCard>
                )}

                {/* Living Situation */}
                {sectionVisible('living') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Living Situation</h2>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Residential Status</label>
                        <select {...regEdit('residential_status')} className="led-input">
                          <option value="">Select...</option>
                          {['Owner', 'Renting', 'Living with parents', 'Other'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Time at Address</label>
                        <input type="text" placeholder="e.g. 2 years" className="led-input" {...regEdit('time_at_address')} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Number of Dependants</label>
                        <input type="number" min="0" className="led-input" {...regEdit('applicant_num_dependants')} />
                      </div>
                      <div className="flex flex-col justify-end pb-[2px]">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 rounded accent-primary" {...regEdit('has_partner')} />
                          <span className="text-[13px] font-medium text-foreground">Has a partner</span>
                        </label>
                      </div>
                      <div className="flex flex-col justify-end pb-[2px]">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 rounded accent-primary" {...regEdit('partner_working')} />
                          <span className="text-[13px] font-medium text-foreground">Partner is working</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </GlassCard>
                )}

                {/* Employment & Income */}
                {sectionVisible('employment', 'income') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Employment & Income</h2>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Employment Category</label>
                        <select {...regEdit('employment_category')} className="led-input">
                          <option value="">Select...</option>
                          {['Full-time', 'Part-time', 'Casual', 'Self-employed', 'Contract', 'Retired', 'Unemployed'].map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Employer Name</label>
                        <input type="text" className="led-input" {...regEdit('employer_name')} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Industry</label>
                        <input type="text" className="led-input" {...regEdit('employer_industry')} />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Job Title</label>
                        <input type="text" className="led-input" {...regEdit('job_title')} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Income Frequency</label>
                        <select {...regEdit('income_frequency')} className="led-input">
                          <option value="">Select...</option>
                          {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Gross Income (AUD)</label>
                        <div className="flex h-10 overflow-hidden rounded-lg border border-[var(--led-line-strong)] bg-[var(--led-surface)] transition-all focus-within:border-[var(--led-accent)] focus-within:shadow-[0_0_0_3px_var(--led-accent-tint)]">
                          <span className="flex shrink-0 items-center border-r border-[var(--led-line-strong)] bg-secondary/60 px-3 text-[13px] font-medium text-muted-foreground">$</span>
                          <input type="text" inputMode="numeric" placeholder="0" className="flex-1 bg-transparent px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                            {...regEdit('gross_income')} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); regEdit('gross_income').onChange({ target: { value: v } }); }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </GlassCard>
                )}

                {/* Business Details */}
                {sectionVisible('business') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Business Details</h2>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Trading Name</label>
                        <input type="text" className="led-input" {...regEdit('trading_name')} />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Business Structure</label>
                        <select {...regEdit('business_structure')} className="led-input">
                          <option value="">Select...</option>
                          {['Sole Trader', 'Partnership', 'Company', 'Trust'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Time Trading</label>
                        <input type="text" placeholder="e.g. 3 years" className="led-input" {...regEdit('time_trading')} />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Number of Directors</label>
                        <input type="number" min="1" className="led-input" {...regEdit('num_directors')} />
                      </div>
                      <div className="flex flex-col justify-end pb-[2px]">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 rounded accent-primary" {...regEdit('gst_registered')} />
                          <span className="text-[13px] font-medium text-foreground">GST Registered</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </GlassCard>
                )}

                {/* Emergency Contact */}
                {sectionVisible('emergency') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Emergency Contact</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Name</label>
                      <input type="text" className="led-input" {...regEdit('emergency_contact_name')} />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Relationship</label>
                      <input type="text" className="led-input" placeholder="e.g. Spouse, Parent" {...regEdit('emergency_contact_relationship')} />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Phone</label>
                      <input type="tel" className="led-input" placeholder="04XX XXX XXX" {...regEdit('emergency_contact_phone')} />
                    </div>
                  </div>
                </GlassCard>
                )}

                {/* Declarations */}
                {sectionVisible('declarations') && (
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Declarations</h2>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" className="h-4 w-4 rounded accent-primary" {...regEdit('previously_declined')} />
                        <span className="text-[13px] font-medium text-foreground">Previously declined for credit</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Change of Circumstances</label>
                      <textarea rows={2} className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground" placeholder="Any changes in financial circumstances..." {...regEdit('change_of_circumstances')} />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Signature Name</label>
                      <input type="text" className="led-input" placeholder="Full legal name" {...regEdit('signature_name')} />
                    </div>
                  </div>
                </GlassCard>
                )}

                <div className="flex items-center gap-3 pb-2">
                  <Button onClick={handleEditSubmit(handleSaveDetails)} loading={savingDetails}>Save Details</Button>
                </div>

                {/* Read-only: Lend extra data (identification, financial position) */}
                {application.lend_extra_data && (() => {
                  let extra: Record<string, unknown> = {};
                  try { extra = JSON.parse(application.lend_extra_data); } catch { return null; }
                  const idEntry = Array.isArray(extra.identification) ? (extra.identification as Array<Record<string, string>>)[0] : null;
                  const empEntry = Array.isArray(extra.employments) ? (extra.employments as Array<Record<string, string>>)[0] : null;
                  const incomes = Array.isArray(extra.incomes) ? (extra.incomes as Array<{ income_type?: string; amount?: number; frequency?: string }>).filter(i => (i.amount ?? 0) > 0) : [];
                  const realEstateAssets: Array<Record<string, any>> = Array.isArray((extra.assets as Record<string, any> | undefined)?.real_estate) ? (extra.assets as Record<string, any[]>).real_estate as Array<Record<string, any>> : [];
                  const otherAssets: Array<Record<string, any>> = Array.isArray((extra.assets as Record<string, any> | undefined)?.other) ? (extra.assets as Record<string, any[]>).other as Array<Record<string, any>> : [];
                  const liabs: Array<Record<string, any>> = Array.isArray(extra.liabilities) ? extra.liabilities as Array<Record<string, any>> : [];
                  const expenses = extra.expenses as Record<string, number> | undefined;
                  const hasAny = idEntry || empEntry || incomes.length > 0 || realEstateAssets.length > 0 || otherAssets.length > 0 || liabs.length > 0 || (expenses && Object.values(expenses).some(v => v > 0));
                  if (!hasAny) return null;
                  return (
                    <div className="space-y-6 mt-6 pt-6 border-t border-border">
                      <p className="text-[13px] font-semibold text-muted-foreground">Application Data (Read-only)</p>

                      {/* Identification */}
                      {sectionVisible('identification') && idEntry && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">ID Document</h2>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {idEntry.type && <div><p className="text-[12px] text-muted-foreground">ID Type</p><p className="text-[14px] font-medium text-foreground">{idEntry.type}</p></div>}
                            {idEntry.number && <div><p className="text-[12px] text-muted-foreground">ID Number</p><p className="text-[14px] font-medium text-foreground">{idEntry.number}</p></div>}
                            {(idEntry.state || idEntry.country) && <div><p className="text-[12px] text-muted-foreground">{idEntry.state ? 'Issuing State' : 'Issuing Country'}</p><p className="text-[14px] font-medium text-foreground">{idEntry.state || idEntry.country}</p></div>}
                          </div>
                        </GlassCard>
                      )}

                      {/* Employment details */}
                      {sectionVisible('employment') && empEntry && (empEntry.employment_type || empEntry.start_date || empEntry.contact_details) && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">Employment Details</h2>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {empEntry.employment_type && <div><p className="text-[12px] text-muted-foreground">Employment Type</p><p className="text-[14px] font-medium text-foreground">{empEntry.employment_type}</p></div>}
                            {empEntry.start_date && <div><p className="text-[12px] text-muted-foreground">Start Date</p><p className="text-[14px] font-medium text-foreground">{empEntry.start_date}</p></div>}
                            {empEntry.contact_details && <div><p className="text-[12px] text-muted-foreground">Employer Contact</p><p className="text-[14px] font-medium text-foreground">{empEntry.contact_details}</p></div>}
                          </div>
                        </GlassCard>
                      )}

                      {/* Income */}
                      {sectionVisible('income') && incomes.length > 0 && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">Income</h2>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {incomes.map((inc, i) => (
                              <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                <p className="text-[12px] text-muted-foreground">{i === 0 ? 'Primary Income' : `Additional Income ${i}`}</p>
                                <p className="text-[14px] font-medium text-foreground">{inc.income_type}{inc.amount ? ` — $${Number(inc.amount).toLocaleString('en-AU')}` : ''}{inc.frequency ? ` / ${inc.frequency}` : ''}</p>
                              </div>
                            ))}
                          </div>
                        </GlassCard>
                      )}

                      {/* Expenses */}
                      {sectionVisible('expenses') && expenses && (expenses.monthly_living > 0 || expenses.rent_mortgage > 0 || expenses.child_support > 0 || expenses.other_commitments > 0) && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">Monthly Expenses</h2>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {expenses.monthly_living > 0 && <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Living Expenses</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.monthly_living).toLocaleString('en-AU')}/mo</p></div>}
                            {expenses.rent_mortgage > 0 && <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Rent / Mortgage</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.rent_mortgage).toLocaleString('en-AU')}/mo</p></div>}
                            {expenses.child_support > 0 && <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Child Support</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.child_support).toLocaleString('en-AU')}/mo</p></div>}
                            {expenses.other_commitments > 0 && <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Other Commitments</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.other_commitments).toLocaleString('en-AU')}/mo</p></div>}
                          </div>
                        </GlassCard>
                      )}

                      {/* Real Estate Assets */}
                      {sectionVisible('assets') && realEstateAssets.length > 0 && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">Real Estate Assets</h2>
                          <div className="space-y-3">
                            {realEstateAssets.map((asset, i) => (
                              <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                <p className="text-[13px] font-medium text-foreground">{String(asset.property_type || `Property ${i + 1}`)}</p>
                                {asset.address && <p className="text-[13px] text-muted-foreground mt-0.5">{String(asset.address)}</p>}
                                <div className="flex gap-4 flex-wrap mt-1.5">
                                  {(asset.estimated_value as number) > 0 && <span className="text-[12px] text-foreground">Value: ${Number(asset.estimated_value).toLocaleString('en-AU')}</span>}
                                  {asset.ownership_type && <span className="text-[12px] text-muted-foreground">Ownership: {String(asset.ownership_type)}</span>}
                                  {asset.is_financed === 'yes' && asset.lender && <span className="text-[12px] text-muted-foreground">Lender: {String(asset.lender)}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </GlassCard>
                      )}

                      {/* Other Assets */}
                      {sectionVisible('assets') && otherAssets.length > 0 && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">Other Assets</h2>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {otherAssets.map((asset, i) => (
                              <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                <p className="text-[12px] text-muted-foreground">{String(asset.asset_type || `Asset ${i + 1}`)}</p>
                                {(asset.value as number) > 0 && <p className="text-[14px] font-medium text-foreground">${Number(asset.value).toLocaleString('en-AU')}</p>}
                              </div>
                            ))}
                          </div>
                        </GlassCard>
                      )}

                      {/* Liabilities */}
                      {sectionVisible('liabilities') && liabs.length > 0 && (
                        <GlassCard>
                          <h2 className="text-[15px] font-semibold text-foreground mb-4">Liabilities</h2>
                          <div className="space-y-3">
                            {liabs.map((liab, i) => (
                              <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                <p className="text-[13px] font-medium text-foreground">{String(liab.liability_type || `Liability ${i + 1}`)}</p>
                                <div className="flex gap-4 flex-wrap mt-1.5">
                                  {liab.lender && <span className="text-[12px] text-muted-foreground">Lender: {String(liab.lender)}</span>}
                                  {(liab.balance as number) > 0 && <span className="text-[12px] text-foreground">Balance: ${Number(liab.balance).toLocaleString('en-AU')}</span>}
                                  {(liab.monthly_repayment as number) > 0 && <span className="text-[12px] text-muted-foreground">Repayment: ${Number(liab.monthly_repayment).toLocaleString('en-AU')}/mo</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </GlassCard>
                      )}

                      {/* Loan Type Details */}
                      {sectionVisible('loan_details') && (() => {
                        try {
                          const extraData = JSON.parse(application.lend_extra_data || '{}');
                          const loanDetails = extraData.loan_type_details;
                          if (!loanDetails || Object.keys(loanDetails).length === 0) return null;

                          return (
                            <GlassCard>
                              <h2 className="text-[15px] font-semibold text-foreground mb-4">Loan Type Details</h2>
                              <div className="space-y-4">
                                {(() => {
                                  const subType: string | undefined = loanDetails.consumer_loan_type?.type || loanDetails.commercial_loan_type?.type;
                                  if (!subType) return null;
                                  const categoryLabel = LOAN_CATEGORIES.find(c => c.value === categoryForSubType(subType))?.label;
                                  const storedLabel = loanDetails.consumer_loan_type?.label || loanDetails.commercial_loan_type?.label;
                                  const subTypeLabel = findLoanSubType(subType)?.label || storedLabel || subType.replace(/_/g, ' ');
                                  return (
                                    <div className="rounded-xl bg-secondary p-4">
                                      <p className="text-[13px] font-medium text-muted-foreground">{categoryLabel}</p>
                                      <p className="mt-1 text-[16px] font-semibold text-foreground">{subTypeLabel}</p>
                                    </div>
                                  );
                                })()}

                                {loanDetails.vehicle_details && (
                                  <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                                    <p className="text-[13px] font-semibold text-foreground">Vehicle Information</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      {loanDetails.vehicle_details.make && <div><p className="text-[12px] text-muted-foreground">Make</p><p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.make}</p></div>}
                                      {loanDetails.vehicle_details.model && <div><p className="text-[12px] text-muted-foreground">Model</p><p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.model}</p></div>}
                                      {loanDetails.vehicle_details.year && <div><p className="text-[12px] text-muted-foreground">Year</p><p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.year}</p></div>}
                                      {loanDetails.vehicle_details.condition && <div><p className="text-[12px] text-muted-foreground">Condition</p><p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.condition}</p></div>}
                                      {loanDetails.vehicle_details.price > 0 && <div><p className="text-[12px] text-muted-foreground">Price</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.vehicle_details.price).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.vehicle_details.deposit > 0 && <div><p className="text-[12px] text-muted-foreground">Deposit</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.vehicle_details.deposit).toLocaleString('en-AU')}</p></div>}
                                    </div>
                                  </div>
                                )}

                                {loanDetails.property_details && (
                                  <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                                    <p className="text-[13px] font-semibold text-foreground">Property Information</p>
                                    {loanDetails.property_details.address && <div><p className="text-[12px] text-muted-foreground">Address</p><p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.address}</p></div>}
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      {loanDetails.property_details.property_type && <div><p className="text-[12px] text-muted-foreground">Property Type</p><p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.property_type}</p></div>}
                                      {loanDetails.property_details.property_use && <div><p className="text-[12px] text-muted-foreground">Property Use</p><p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.property_use}</p></div>}
                                      {loanDetails.property_details.value > 0 && <div><p className="text-[12px] text-muted-foreground">Property Value</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.property_details.value).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.property_details.deposit > 0 && <div><p className="text-[12px] text-muted-foreground">Deposit</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.property_details.deposit).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.property_details.first_home_buyer !== undefined && <div><p className="text-[12px] text-muted-foreground">First Home Buyer</p><p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.first_home_buyer ? 'Yes' : 'No'}</p></div>}
                                      {loanDetails.property_details.current_lender && <div><p className="text-[12px] text-muted-foreground">Current Lender</p><p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.current_lender}</p></div>}
                                    </div>
                                    {loanDetails.property_details.refinance_reason && <div><p className="text-[12px] text-muted-foreground">Refinance Reason</p><p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.refinance_reason}</p></div>}
                                  </div>
                                )}

                                {loanDetails.asset_details && (
                                  <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                                    <p className="text-[13px] font-semibold text-foreground">Asset Information</p>
                                    {loanDetails.asset_details.equipment_type && <div><p className="text-[12px] text-muted-foreground">Asset Type</p><p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.equipment_type}</p></div>}
                                    {loanDetails.asset_details.description && <div><p className="text-[12px] text-muted-foreground">Description</p><p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.description}</p></div>}
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      {loanDetails.asset_details.price > 0 && <div><p className="text-[12px] text-muted-foreground">Price</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.asset_details.price).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.asset_details.deposit > 0 && <div><p className="text-[12px] text-muted-foreground">Deposit</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.asset_details.deposit).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.asset_details.vendor_type && <div><p className="text-[12px] text-muted-foreground">Vendor Type</p><p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.vendor_type}</p></div>}
                                      {loanDetails.asset_details.condition && <div><p className="text-[12px] text-muted-foreground">Condition</p><p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.condition}</p></div>}
                                      {loanDetails.asset_details.business_use_pct > 0 && <div><p className="text-[12px] text-muted-foreground">Business Use %</p><p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.business_use_pct}%</p></div>}
                                    </div>
                                  </div>
                                )}

                                {loanDetails.business_details && (
                                  <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                                    <p className="text-[13px] font-semibold text-foreground">Business Information</p>
                                    {loanDetails.business_details.business_plan && <div><p className="text-[12px] text-muted-foreground">Business Plan</p><p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.business_plan}</p></div>}
                                    {loanDetails.business_details.business_details && <div><p className="text-[12px] text-muted-foreground">Business Details</p><p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.business_details}</p></div>}
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      {loanDetails.business_details.startup_costs > 0 && <div><p className="text-[12px] text-muted-foreground">Startup Costs</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.business_details.startup_costs).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.business_details.purchase_price > 0 && <div><p className="text-[12px] text-muted-foreground">Purchase Price</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.business_details.purchase_price).toLocaleString('en-AU')}</p></div>}
                                      {loanDetails.business_details.industry && <div><p className="text-[12px] text-muted-foreground">Industry</p><p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.industry}</p></div>}
                                      {loanDetails.business_details.business_type && <div><p className="text-[12px] text-muted-foreground">Business Type</p><p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.business_type}</p></div>}
                                    </div>
                                  </div>
                                )}

                                {loanDetails.working_capital && (
                                  <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                                    <p className="text-[13px] font-semibold text-foreground">Working Capital Details</p>
                                    {loanDetails.working_capital.expansion_description && <div><p className="text-[12px] text-muted-foreground">Expansion Plans</p><p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.expansion_description}</p></div>}
                                    {loanDetails.working_capital.recruitment_details && <div><p className="text-[12px] text-muted-foreground">Recruitment Details</p><p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.recruitment_details}</p></div>}
                                    {loanDetails.working_capital.supplier_details && <div><p className="text-[12px] text-muted-foreground">Supplier Details</p><p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.supplier_details}</p></div>}
                                    {loanDetails.working_capital.outstanding_invoices && <div><p className="text-[12px] text-muted-foreground">Outstanding Invoices</p><p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.outstanding_invoices}</p></div>}
                                    {loanDetails.working_capital.purpose_description && <div><p className="text-[12px] text-muted-foreground">Purpose</p><p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.purpose_description}</p></div>}
                                    {loanDetails.working_capital.loan_amount > 0 && <div><p className="text-[12px] text-muted-foreground">Loan Amount</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.working_capital.loan_amount).toLocaleString('en-AU')}</p></div>}
                                  </div>
                                )}

                                {loanDetails.personal_loan && (
                                  <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                                    <p className="text-[13px] font-semibold text-foreground">Personal Loan Details</p>
                                    {loanDetails.personal_loan.purpose && <div><p className="text-[12px] text-muted-foreground">Purpose</p><p className="text-[14px] font-medium text-foreground">{loanDetails.personal_loan.purpose}</p></div>}
                                    {loanDetails.personal_loan.amount > 0 && <div><p className="text-[12px] text-muted-foreground">Amount</p><p className="text-[14px] font-medium text-foreground">${Number(loanDetails.personal_loan.amount).toLocaleString('en-AU')}</p></div>}
                                    {loanDetails.personal_loan.term && <div><p className="text-[12px] text-muted-foreground">Term</p><p className="text-[14px] font-medium text-foreground">{loanDetails.personal_loan.term}</p></div>}
                                  </div>
                                )}
                              </div>
                            </GlassCard>
                          );
                        } catch { return null; }
                      })()}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── DOCUMENTS ── */}
            {activeTab === 'documents' && (
              <>
                {/* Draft Actions */}
                {isDraft && (
                  <GlassCard className="mb-6 border-primary/20 bg-primary/5">
                    <h2 className="text-[15px] font-semibold text-foreground mb-4">Draft Actions</h2>
                    <div className="mb-4">
                      <h3 className="text-[13px] font-medium text-foreground mb-3">Recommended Documents</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {RECOMMENDED_DOC_TYPES.map((type) => (
                          <div key={type} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] transition-all duration-200 ${uploadedDocTypes.has(type) ? 'bg-success/10 text-success border border-success/20' : 'bg-background border border-border/50 text-muted-foreground'}`}>
                            {uploadedDocTypes.has(type) ? (
                              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            ) : (
                              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><circle cx="12" cy="12" r="9" /></svg>
                            )}
                            <span className="font-medium">{DOC_TYPE_LABELS[type]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
                      <input
                        type="text"
                        value={fileLabel}
                        onChange={(e) => setFileLabel(e.target.value)}
                        placeholder="Label (optional)"
                        className="rounded-xl bg-background px-3.5 py-2 text-[14px] text-foreground h-11 border border-border/50 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                      />
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value as DocType)}
                        className="rounded-xl bg-background px-3.5 py-2 text-[14px] text-foreground h-11 border border-border/50 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <div className="relative flex-1">
                        <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUploadDoc} disabled={uploading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        <div className="flex items-center justify-center gap-2 h-11 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors font-medium text-[13px]">
                          {uploading ? (
                            <><svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Uploading...</>
                          ) : (
                            <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg> Click to Upload</>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button variant={allDocsUploaded ? 'success' : 'primary'} size="lg" className="w-full" onClick={() => setConfirmBrokerSubmit(true)} disabled={submittingOnBehalf} loading={submittingOnBehalf}>
                      Submit Application
                    </Button>
                  </GlassCard>
                )}

                {/* Document Requests */}
                {docRequests.length > 0 && (
                  <GlassCard className="mb-6 border-warning/20 bg-warning/5">
                    <h2 className="text-[15px] font-semibold text-foreground mb-4">Document Requests</h2>
                    <div className="space-y-2">
                      {docRequests.map((req) => (
                        <div key={req.id} className={`flex items-start gap-3 rounded-xl p-3.5 border ${req.status === 'fulfilled' ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'}`}>
                          <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${req.status === 'fulfilled' ? 'bg-success/20' : 'bg-warning/20'}`}>
                            {req.status === 'fulfilled' ? (
                              <svg className="h-3 w-3 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            ) : (
                              <svg className="h-3 w-3 text-warning" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-foreground">{req.description}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Requested by {req.requested_by_name} &middot; {formatDate(req.created_at)}
                              {req.status === 'fulfilled' && req.fulfilled_at && ` · Fulfilled ${formatDate(req.fulfilled_at)}`}
                            </p>
                            {req.document_id && (
                              <button
                                type="button"
                                onClick={() => downloadFile(req.document_id!, req.document_filename || 'document')}
                                className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                {req.document_filename || 'Download'}
                              </button>
                            )}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${req.status === 'fulfilled' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                            {req.status === 'fulfilled' ? 'Fulfilled' : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                )}

                {/* Documents list */}
                <GlassCard>
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-[15px] font-semibold text-foreground">Documents</h2>
                    <div className="flex items-center gap-2">
                      {!isDraft && (
                        <>
                          <input
                            type="text"
                            value={fileLabel}
                            onChange={(e) => setFileLabel(e.target.value)}
                            placeholder="Label (optional)"
                            className="rounded-lg bg-secondary px-2.5 py-1.5 text-[12px] text-foreground h-8 w-36 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                          />
                          <select
                            value={docType}
                            onChange={(e) => setDocType(e.target.value as DocType)}
                            className="rounded-lg bg-secondary px-2.5 py-1.5 text-[12px] text-foreground h-8 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <div className="relative">
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUploadDoc} disabled={uploading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                            <Button size="sm" variant="secondary" className="h-8 pointer-events-none" loading={uploading}>
                              {uploading ? 'Uploading...' : 'Upload'}
                            </Button>
                          </div>
                          <div className="h-4 w-[1px] bg-border" />
                        </>
                      )}
                      <Button size="sm" variant="secondary" className="h-8" onClick={() => setShowDocRequestForm((v) => !v)}>
                        <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        Request Docs
                      </Button>
                    </div>
                  </div>

                  {showDocRequestForm && (
                    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <p className="text-[13px] font-medium text-foreground mb-1">Specify which documents you need from the client</p>
                      <p className="text-[12px] text-muted-foreground mb-3">Each becomes its own upload field on the client's view.</p>
                      <div className="space-y-2">
                        {docRequestItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={item}
                              onChange={(e) => setDocRequestItems((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setDocRequestItems((prev) => [...prev, '']); } }}
                              placeholder={`Document ${idx + 1} — e.g. Last 3 months of bank statements`}
                              className="flex-1 rounded-lg bg-background px-3 py-2 text-[13px] text-foreground border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                            />
                            {docRequestItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setDocRequestItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                title="Remove"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setDocRequestItems((prev) => [...prev, ''])}
                        className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        Add document
                      </button>
                      <div className="flex items-center gap-2 mt-3">
                        <Button size="sm" onClick={handleSubmitDocRequest} disabled={!docRequestItems.some((s) => s.trim()) || submittingDocRequest} loading={submittingDocRequest}>Send Request</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowDocRequestForm(false); setDocRequestItems(['']); }}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {documents.length === 0 ? (
                    <div className="rounded-xl bg-secondary/50 p-6 text-center">
                      <svg className="mx-auto h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                      <p className="text-[14px] text-muted-foreground">No documents uploaded</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {documents.map((doc) => (
                        <div key={doc.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl bg-secondary/30 p-4 transition-all duration-200 border border-border/50 hover:bg-secondary/60">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background border border-border/50 shadow-sm">
                              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[14px] font-semibold text-foreground mb-0.5">{doc.original_filename}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-muted-foreground truncate">{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type} &middot; {formatDate(doc.uploaded_at)}</span>
                                {doc.ocr_status && (
                                  <Badge type="custom" value={OCR_STATUS_BADGE[doc.ocr_status].label} className={OCR_STATUS_BADGE[doc.ocr_status].className} />
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 bg-background/50 p-1.5 rounded-lg border border-border/50">
                            {doc.is_verified ? (
                              <Badge type="custom" value="Verified" className="bg-success/10 text-success py-1 px-2 mx-1" />
                            ) : (
                              <Button variant="success" size="sm" onClick={() => handleVerifyDoc(doc.id)} className="h-7 px-3 text-[12px]">Verify</Button>
                            )}
                            <div className="h-4 w-[1px] bg-border mx-1" />
                            <button onClick={() => setPreviewDoc({ id: doc.id, filename: doc.original_filename, ocrStatus: doc.ocr_status })} className="led-btn led-btn-ghost led-btn-sm !px-1.5 hover:!text-[var(--led-info)] hover:!bg-[var(--led-info-tint)]" title="Preview">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            </button>
                            <button onClick={() => downloadFile(doc.id, doc.original_filename)} className="led-btn led-btn-ghost led-btn-sm !px-1.5" title="Download">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            </button>
                            {doc.ocr_status && (doc.ocr_status === 'failed' || doc.ocr_status === 'completed') && (
                              <button onClick={() => handleRetryOcr(doc.id)} disabled={retryingOcr === doc.id} className="led-btn led-btn-ghost led-btn-sm !px-1.5 disabled:opacity-50" title="Redo OCR">
                                <svg className={`h-4 w-4 ${retryingOcr === doc.id ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              </>
            )}

            {/* ── MESSAGES ── */}
            {activeTab === 'messages' && (
              <GlassCard>
                {(() => {
                  const broker = application?.assigned_brokers?.[0] ?? null;
                  const canChat = !!broker && !!currentUser?.id;
                  return (
                    <div className="flex flex-col h-[460px]">
                      {!broker ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2 opacity-60">
                          <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                          <p className="text-[13px] text-muted-foreground">No broker assigned yet</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 mb-3">
                            {clientMessages.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full gap-2 opacity-60">
                                <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                                <p className="text-[13px] text-muted-foreground">No messages yet — say hello</p>
                              </div>
                            ) : (
                              clientMessages.map((msg) => {
                                const isOwn = msg.author_id === currentUser?.id;
                                return (
                                  <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                                    <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                                      <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || broker.full_name)}</span>
                                      <span className="text-[11px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                                    </div>
                                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm'}`}>
                                      <p className="whitespace-pre-wrap">{msg.content}</p>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* Compose */}
                          <div className="rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 transition-colors flex flex-col">
                            <textarea
                              value={newClientMsgContent}
                              onChange={(e) => setNewClientMsgContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  if (canChat && newClientMsgContent.trim()) {
                                    setSendingClientMsg(true);
                                    api.post(`/clients/${currentUser!.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: broker.id, application_id: id })
                                      .then(({ data }) => { setClientMessages((prev) => [...prev, data]); setNewClientMsgContent(''); toast('Message sent', 'success'); })
                                      .catch((err: unknown) => toast(getErrorMessage(err, 'Failed to send'), 'error'))
                                      .finally(() => setSendingClientMsg(false));
                                  }
                                }
                              }}
                              rows={2}
                              className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none"
                              placeholder={`Message ${broker.full_name}…`}
                            />
                            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                              <span className="text-[11px] text-muted-foreground">⌘↵ to send</span>
                              <Button
                                size="sm"
                                className="rounded-xl h-8 px-3.5"
                                loading={sendingClientMsg}
                                disabled={!newClientMsgContent.trim() || !canChat}
                                onClick={async () => {
                                  if (!canChat || !newClientMsgContent.trim()) return;
                                  setSendingClientMsg(true);
                                  try {
                                    const { data } = await api.post(`/clients/${currentUser!.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: broker.id, application_id: id });
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
                                <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                                Send
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </GlassCard>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6 sticky top-6">
          {/* Actions */}
          {/* Assigned Brokers */}
          {application.assigned_brokers.length > 0 && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-4">Assigned Brokers</h2>
              <div className="space-y-2">
                {application.assigned_brokers.map((ab) => (
                  <div key={ab.id} className="flex items-center gap-3 rounded-xl bg-primary/10 p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                      <span className="text-[11px] font-semibold text-primary-foreground">{getInitials(ab.full_name)}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-primary flex-1">{ab.full_name}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Modals */}
      {previewDoc && (
        <DocumentPreviewModal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          documentId={previewDoc.id}
          filename={previewDoc.filename}
          ocrStatus={previewDoc.ocrStatus}
        />
      )}

      <ConfirmDialog
        open={confirmBrokerSubmit}
        title="Submit this application now?"
        message="This will submit the application on behalf of the client. They will be notified by email."
        confirmText="Submit Application"
        loading={submittingOnBehalf}
        onConfirm={handleBrokerSubmit}
        onCancel={() => { if (!submittingOnBehalf) setConfirmBrokerSubmit(false); }}
      />
    </div>
  );
}
