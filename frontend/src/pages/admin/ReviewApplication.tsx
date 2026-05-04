import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client';
import AnalysisPanel from '../../components/AnalysisPanel';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import QuoteSheetComparison from '../../components/QuoteSheetComparison';
import QuoteSheetEditor from '../../components/QuoteSheetEditor';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useBrokerAssignment } from '../../hooks/useBrokerAssignment';
import { useFileDownload } from '../../hooks/useFileDownload';
import { GlassCard, Badge, Button, ConfirmDialog } from '../../components/ui';
import { getErrorMessage, formatDate, getInitials } from '../../lib/utils';
import { DOC_TYPE_LABELS, OCR_STATUS_BADGE, QUOTE_SHEET_STATUS_BADGE, RECOMMENDED_DOC_TYPES, STATUS_LABEL, VALID_TRANSITIONS } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import type { ActivityLog, ApplicationNote, BrokerGroup, ClientAlert, ClientMessage, DocType, Document, DocumentRequest, Lender, LenderSubmission, LenderSubmissionStatus, LoanApplication, LoanType, QuoteSheet, User } from '../../types';
import { ACTION_ICON_CONFIG, ACTION_LABELS } from '../../lib/constants';
import { SUBMISSION_STATUS_BADGE } from '../../lib/constants';

export default function ReviewApplication() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { assignBroker, unassignBroker } = useBrokerAssignment();
  const { downloadFile } = useFileDownload();

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [client, setClient] = useState<User | null>(null);
  const [referrer, setReferrer] = useState<{ id: string; full_name: string; email: string; phone: string | null } | null>(null);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [appNotes, setAppNotes] = useState<ApplicationNote[]>([]);
  const [msgTab, setMsgTab] = useState<'client_messages' | 'deal_notes' | 'alerts'>('client_messages');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [newClientMsgContent, setNewClientMsgContent] = useState('');
  const [sendingClientMsg, setSendingClientMsg] = useState(false);
  const [alerts, setAlerts] = useState<ClientAlert[]>([]);
  const [newAlertContent, setNewAlertContent] = useState('');
  const [sendingAlert, setSendingAlert] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);
  const [retryingOcr, setRetryingOcr] = useState<string | null>(null);
  const [brokerGroups, setBrokerGroups] = useState<BrokerGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'submissions' | 'quotes' | 'messages' | 'activity'>('overview');
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Document requests state
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [showDocRequestForm, setShowDocRequestForm] = useState(false);
  const [docRequestDescription, setDocRequestDescription] = useState('');
  const [submittingDocRequest, setSubmittingDocRequest] = useState(false);

  // Quote sheets state
  const [quoteSheets, setQuoteSheets] = useState<QuoteSheet[]>([]);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [editingQuoteSheet, setEditingQuoteSheet] = useState<QuoteSheet | null>(null);
  const [viewingQuoteSheet, setViewingQuoteSheet] = useState<QuoteSheet | null>(null);
  const [pdfRenderSheet, setPdfRenderSheet] = useState<{ sheet: QuoteSheet; clientFacing: boolean } | null>(null);
  const viewKeyRef = useRef(0);
  // Send modal state
  const [sendModalSheet, setSendModalSheet] = useState<QuoteSheet | null>(null);
  const [sendModalTerms, setSendModalTerms] = useState<number[]>([]);
  const [sendingQuote, setSendingQuote] = useState(false);

  const handleDownloadPdf = useCallback(async (sheet: QuoteSheet, clientFacing = false) => {
    setPdfRenderSheet({ sheet, clientFacing });
    // Wait for React to mount the off-screen element
    await new Promise(r => setTimeout(r, 100));
    try {
      const suffix = clientFacing ? 'client' : 'internal';
      await downloadQuoteSheetPdf(`quote-sheet-pdf-${sheet.id}`, `quote-sheet-v${sheet.version}-${suffix}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    } finally {
      setPdfRenderSheet(null);
    }
  }, []);

  // Lender submissions state
  const [lenderSubmissions, setLenderSubmissions] = useState<LenderSubmission[]>([]);
  const [availableLenders, setAvailableLenders] = useState<Lender[]>([]);
  const [showSubForm, setShowSubForm] = useState(false);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [subForm, setSubForm] = useState({ lender_id: '', status: 'pending', offered_rate: '', offered_amount: '', conditions: '', notes: '' });
  const [savingSub, setSavingSub] = useState(false);

  // Broker edit state
  const [editLoanType, setEditLoanType] = useState<LoanType>('personal');

  const [editNotes, setEditNotes] = useState('');

  const [editing, setEditing] = useState(false);
  const [savingEditFields, setSavingEditFields] = useState(false);
  const [submittingOnBehalf, setSubmittingOnBehalf] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [confirmBrokerSubmit, setConfirmBrokerSubmit] = useState(false);
  const [docType, setDocType] = useState<DocType>('id_proof');
  const [uploading, setUploading] = useState(false);
  const [fileLabel, setFileLabel] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const [leadFields, setLeadFields] = useState({
    applicant_title: '', applicant_first_name: '', applicant_last_name: '', applicant_middle_name: '',
    applicant_dob: '', applicant_gender: '', applicant_marital_status: '',
    applicant_address: '', applicant_suburb: '', applicant_state: '', applicant_postcode: '',
    business_name: '', business_abn: '', business_registration_date: '', business_industry_id: '',
    business_monthly_sales: '', loan_term_years: '', loan_term_months: '', loan_purpose_id: '', amount: '',
  });
  const updateLeadField = (field: string, value: string) => setLeadFields((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!id || activeTab !== 'activity') return;
    setActivityLoading(true);
    api.get(`/activity-logs/application/${id}`)
      .then(({ data }) => setActivityLogs(data))
      .catch(() => toast('Failed to load activity', 'error'))
      .finally(() => setActivityLoading(false));
  }, [id, activeTab]);

  useEffect(() => {
    if (!id) return;
    // Fetch broker groups
    api.get('/broker-groups').then(({ data }) => setBrokerGroups(data)).catch(() => { });
    // Fetch lender submissions and available lenders
    api.get(`/applications/${id}/submissions`).then(({ data }) => setLenderSubmissions(data)).catch(() => { });
    api.get('/lenders').then(({ data }) => setAvailableLenders(data)).catch(() => { });
    api.get(`/applications/${id}/quote-sheets`).then(({ data }) => setQuoteSheets(data)).catch(() => { });
    api.get(`/documents/requests/${id}`).then(({ data }) => setDocRequests(data)).catch(() => { });

    Promise.all([
      api.get(`/applications/${id}`),
      api.get(`/documents/application/${id}`),
      api.get('/users'),
      api.get(`/applications/${id}/notes`),
    ])
      .then(([appRes, docRes, usersRes, notesRes]) => {
        setApplication(appRes.data);
        setDocuments(docRes.data);
        setAppNotes(notesRes.data);
        // Init broker edit fields
        setEditLoanType(appRes.data.loan_type);
        setEditNotes(appRes.data.notes || '');
        const d = appRes.data;
        setLeadFields({
          applicant_title: d.applicant_title || '', applicant_first_name: d.applicant_first_name || '',
          applicant_last_name: d.applicant_last_name || '', applicant_middle_name: d.applicant_middle_name || '',
          applicant_dob: d.applicant_dob || '', applicant_gender: d.applicant_gender || '',
          applicant_marital_status: d.applicant_marital_status || '',
          applicant_address: d.applicant_address || '', applicant_suburb: d.applicant_suburb || '',
          applicant_state: d.applicant_state || '', applicant_postcode: d.applicant_postcode || '',
          business_name: d.business_name || '', business_abn: d.business_abn || '',
          business_registration_date: d.business_registration_date || '',
          business_industry_id: d.business_industry_id ? String(d.business_industry_id) : '',
          business_monthly_sales: d.business_monthly_sales ? String(d.business_monthly_sales) : '',
          loan_term_years: d.loan_term_requested ? String(Math.floor(d.loan_term_requested / 12)) : '',
          loan_term_months: d.loan_term_requested ? String(d.loan_term_requested % 12) : '',
          loan_purpose_id: d.loan_purpose_id ? String(d.loan_purpose_id) : '',
          amount: d.amount ? String(d.amount) : '',
        });

        const clientUser = usersRes.data.find((u: User) => u.id === appRes.data.user_id);
        setBrokers(usersRes.data.filter((u: User) => u.role === 'broker'));

        if (clientUser?.role === 'referrer') {
          // Direct referrer lead — user_id IS the referrer, client has no account
          setClient(null);
          setReferrer({ id: clientUser.id, full_name: clientUser.full_name, email: clientUser.email, phone: clientUser.phone });
        } else {
          setClient(clientUser || null);
          if (appRes.data.user_id) {
            api.get(`/users/${appRes.data.user_id}/referrer`)
              .then(({ data }) => setReferrer(data.referrer || null))
              .catch(() => { });
          }
        }
      })
      .catch(() => toast('Failed to load application', 'error'))
      .finally(() => setLoading(false));
  }, [id, toast]);

  useEffect(() => {
    if (!client?.id) return;
    Promise.all([
      api.get(`/clients/${client.id}/messages`),
      api.get(`/clients/${client.id}/alerts`),
    ]).then(([msgsRes, alertsRes]) => {
      setClientMessages(msgsRes.data);
      setAlerts(alertsRes.data);
    }).catch(() => { });
  }, [client?.id]);

  const refetchApplication = async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/applications/${id}`);
      setApplication(data);
    } catch { /* ignore */ }
  };

  const handleStatusChange = (newStatus: string) => {
    if (!id) return;
    setPendingStatus(newStatus);
  };

  const confirmStatusChange = async () => {
    if (!id || !pendingStatus) return;
    setChangingStatus(true);
    try {
      const { data } = await api.patch(`/applications/${id}/status?status=${pendingStatus}`);
      setApplication(data);
      toast(`Status changed to ${pendingStatus}`, 'success');
      setPendingStatus(null);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to change status'), 'error');
    } finally {
      setChangingStatus(false);
    }
  };

  const handleAssignBroker = async (brokerId: string) => {
    if (!id) return;
    const updated = await assignBroker(id, brokerId);
    if (updated) setApplication(updated);
  };

  const handleUnassignBroker = async (brokerId: string) => {
    if (!id) return;
    const updated = await unassignBroker(id, brokerId);
    if (updated) setApplication(updated);
  };

  const handleAssignGroup = async (groupId: string) => {
    if (!id) return;
    try {
      const { data } = await api.post(`/applications/${id}/assign-group?group_id=${groupId}`);
      setApplication(data);
      toast('Broker group assigned', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to assign group'), 'error');
    }
  };

  const handleDownloadDoc = (doc: Document) => downloadFile(doc.id, doc.original_filename);

  const handleVerifyDoc = async (docId: string) => {
    try {
      const { data } = await api.patch(`/documents/${docId}/verify`);
      setDocuments((prev) => prev.map((d) => (d.id === docId ? data : d)));
      toast('Document verified', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to verify'), 'error');
    }
  };

  const handleSubmitDocRequest = async () => {
    if (!id || !docRequestDescription.trim()) return;
    setSubmittingDocRequest(true);
    try {
      const { data } = await api.post(`/documents/requests/${id}`, { description: docRequestDescription.trim() });
      setDocRequests((prev) => [...prev, data]);
      setDocRequestDescription('');
      setShowDocRequestForm(false);
      toast('Document request sent to client', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send request'), 'error');
    } finally {
      setSubmittingDocRequest(false);
    }
  };


  const handleSaveEditFields = async () => {
    if (!id) return;
    setSavingEditFields(true);
    try {
      const payload: Record<string, unknown> = {
        loan_type: editLoanType,
        amount: leadFields.amount ? parseFloat(leadFields.amount) : undefined,
        notes: editNotes || null,
        applicant_title: leadFields.applicant_title || null,
        applicant_first_name: leadFields.applicant_first_name || null,
        applicant_last_name: leadFields.applicant_last_name || null,
        applicant_middle_name: leadFields.applicant_middle_name || null,
        applicant_dob: leadFields.applicant_dob || null,
        applicant_gender: leadFields.applicant_gender || null,
        applicant_marital_status: leadFields.applicant_marital_status || null,
        applicant_address: leadFields.applicant_address || null,
        applicant_suburb: leadFields.applicant_suburb || null,
        applicant_state: leadFields.applicant_state || null,
        applicant_postcode: leadFields.applicant_postcode || null,
        business_name: leadFields.business_name || null,
        business_abn: leadFields.business_abn || null,
        business_registration_date: leadFields.business_registration_date || null,
        business_industry_id: leadFields.business_industry_id ? parseInt(leadFields.business_industry_id) : null,
        business_monthly_sales: leadFields.business_monthly_sales ? parseFloat(leadFields.business_monthly_sales) : null,
        loan_term_requested: (leadFields.loan_term_years || leadFields.loan_term_months)
          ? (parseInt(leadFields.loan_term_years || '0') * 12) + parseInt(leadFields.loan_term_months || '0')
          : null,
        loan_purpose_id: leadFields.loan_purpose_id ? parseInt(leadFields.loan_purpose_id) : null,
      };
      const { data } = await api.patch(`/applications/${id}`, payload);
      setApplication(data);
      setEditing(false);
      toast('Application updated', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save changes'), 'error');
    } finally {
      setSavingEditFields(false);
    }
  };

  const handleBrokerSubmit = () => {
    if (!id) return;
    setConfirmBrokerSubmit(true);
  };

  const confirmBrokerSubmitAction = async () => {
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

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = e.target;
    if (!file || !id) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      toast('File size exceeds 10MB limit', 'error');
      target.value = '';
      return;
    }

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
      target.value = '';
    }
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

  const isDraft = application?.status === 'draft';
  const uploadedDocTypes = new Set(documents.map((d) => d.doc_type));
  const missingDocs = RECOMMENDED_DOC_TYPES.filter((t) => !uploadedDocTypes.has(t));
  const allDocsUploaded = missingDocs.length === 0;

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
      </div>
    );
  }

  const allowedTransitions = VALID_TRANSITIONS[application.status] || [];
  const pendingStatusLabel = pendingStatus ? (STATUS_LABEL[pendingStatus as keyof typeof STATUS_LABEL] || pendingStatus.replace(/_/g, ' ')) : '';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link to="/admin/applications" className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          Back to All Applications
        </Link>
      </div>

      {/* Status Timeline */}
      <GlassCard className="mb-6">
        <h2 className="text-[13px] font-medium text-muted-foreground mb-4">Application Progress</h2>
        <StatusTimeline currentStatus={application.status} />
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Content Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-border/60 mb-6 scrollbar-none">
            {(['overview', 'documents', 'submissions', 'quotes', 'messages', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap px-4 py-4 text-[14px] font-semibold transition-all duration-300 relative capitalize ${activeTab === tab
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-t-lg'
                  }`}
              >
                {tab === 'overview' ? 'Overview' : tab === 'documents' ? 'Docs & Analysis' : tab === 'submissions' ? `Submissions${lenderSubmissions.length ? ` (${lenderSubmissions.length})` : ''}` : tab === 'quotes' ? `Quotes${quoteSheets.length ? ` (${quoteSheets.length})` : ''}` : tab === 'messages' ? 'Messages' : 'Activity'}
                {activeTab === tab && (
                  <div className="absolute bottom-[-1px] left-0 w-full h-[2px] bg-primary rounded-t-full shadow-[0_-2px_8px_rgba(currentcolor,0.5)]" />
                )}
              </button>
            ))}
          </div>

          <div className="space-y-6 animate-in fade-in duration-300">
            {activeTab === 'overview' && (
              <>
                {/* Completion Banner */}
                {application.completed_by_name && (
                  <div className="rounded-2xl bg-primary/10 border border-primary/20 p-4 flex items-center gap-3">
                    <svg className="h-5 w-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                    <p className="text-[13px] font-medium text-primary">
                      Completed by {application.completed_by_name} on {formatDate(application.completed_at!)}
                    </p>
                  </div>
                )}

                {/* Application Info */}
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
                      {editing && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                      )}
                    </div>
                  </div>

                  {editing ? (
                    <div className="space-y-5">
                      {/* Loan basics */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-[13px] font-medium text-muted-foreground mb-2">Loan Type</label>
                          <select
                            value={editLoanType}
                            onChange={(e) => setEditLoanType(e.target.value as LoanType)}
                            className="led-input"
                          >
                            <option value="personal">Personal</option>
                            <option value="home">Home</option>
                            <option value="business">Business</option>
                            <option value="vehicle">Vehicle</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[13px] font-medium text-muted-foreground mb-2">Amount ($)</label>
                          <input type="number" step="0.01" value={leadFields.amount} onChange={(e) => updateLeadField('amount', e.target.value)} className="led-input" placeholder="Enter amount" />
                        </div>
                      </div>

                      {/* Applicant */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Applicant</h3>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Title</label>
                          <select value={leadFields.applicant_title} onChange={(e) => updateLeadField('applicant_title', e.target.value)} className="led-input">
                            <option value="">Select...</option>
                            {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'].map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">First Name</label>
                          <input type="text" value={leadFields.applicant_first_name} onChange={(e) => updateLeadField('applicant_first_name', e.target.value)} className="led-input" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Middle Name</label>
                          <input type="text" value={leadFields.applicant_middle_name} onChange={(e) => updateLeadField('applicant_middle_name', e.target.value)} className="led-input" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Last Name</label>
                          <input type="text" value={leadFields.applicant_last_name} onChange={(e) => updateLeadField('applicant_last_name', e.target.value)} className="led-input" />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">DOB</label>
                          <input type="text" value={leadFields.applicant_dob} onChange={(e) => updateLeadField('applicant_dob', e.target.value)} placeholder="YYYY-MM-DD" className="led-input" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Gender</label>
                          <select value={leadFields.applicant_gender} onChange={(e) => updateLeadField('applicant_gender', e.target.value)} className="led-input">
                            <option value="">Select...</option>
                            {['Male', 'Female', 'Other'].map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Marital Status</label>
                          <select value={leadFields.applicant_marital_status} onChange={(e) => updateLeadField('applicant_marital_status', e.target.value)} className="led-input">
                            <option value="">Select...</option>
                            {['Single', 'Married', 'De Facto', 'Separated', 'Divorced', 'Widowed'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Address */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Address</h3>
                      <div>
                        <label className="block text-[12px] text-muted-foreground mb-1">Street Address</label>
                        <input type="text" value={leadFields.applicant_address} onChange={(e) => updateLeadField('applicant_address', e.target.value)} className="led-input" />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Suburb</label>
                          <input type="text" value={leadFields.applicant_suburb} onChange={(e) => updateLeadField('applicant_suburb', e.target.value)} className="led-input" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">State</label>
                          <select value={leadFields.applicant_state} onChange={(e) => updateLeadField('applicant_state', e.target.value)} className="led-input">
                            <option value="">Select...</option>
                            {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Postcode</label>
                          <input type="text" value={leadFields.applicant_postcode} onChange={(e) => updateLeadField('applicant_postcode', e.target.value)} className="led-input" />
                        </div>
                      </div>

                      {/* Business (only for business loans) */}
                      {editLoanType === 'business' && (
                        <>
                          <h3 className="text-[13px] font-medium text-muted-foreground">Business</h3>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">Business Name</label>
                              <input type="text" value={leadFields.business_name} onChange={(e) => updateLeadField('business_name', e.target.value)} className="led-input" />
                            </div>
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">ABN</label>
                              <input type="text" value={leadFields.business_abn} onChange={(e) => updateLeadField('business_abn', e.target.value)} className="led-input" />
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">Registration Date</label>
                              <input type="text" value={leadFields.business_registration_date} onChange={(e) => updateLeadField('business_registration_date', e.target.value)} placeholder="YYYY-MM-DD" className="led-input" />
                            </div>
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">Industry ID</label>
                              <input type="number" value={leadFields.business_industry_id} onChange={(e) => updateLeadField('business_industry_id', e.target.value)} className="led-input" />
                            </div>
                            <div>
                              <label className="block text-[12px] text-muted-foreground mb-1">Monthly Sales</label>
                              <input type="number" value={leadFields.business_monthly_sales} onChange={(e) => updateLeadField('business_monthly_sales', e.target.value)} className="led-input" />
                            </div>
                          </div>
                        </>
                      )}

                      {/* Loan terms */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Loan Details</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Term (years)</label>
                          <input type="number" min="0" max="30" value={leadFields.loan_term_years} onChange={(e) => updateLeadField('loan_term_years', e.target.value)} className="led-input" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Term (months)</label>
                          <input type="number" min="0" max="11" value={leadFields.loan_term_months} onChange={(e) => updateLeadField('loan_term_months', e.target.value)} className="led-input" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Purpose ID</label>
                          <input type="number" value={leadFields.loan_purpose_id} onChange={(e) => updateLeadField('loan_purpose_id', e.target.value)} className="led-input" />
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="block text-[13px] font-medium text-muted-foreground mb-2">Notes</label>
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={3}
                          className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                          placeholder="Application notes..."
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        <Button onClick={handleSaveEditFields} loading={savingEditFields}>Save Changes</Button>
                        <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl bg-secondary p-4">
                        <dt className="text-[13px] font-medium text-muted-foreground">Amount</dt>
                        <dd className="mt-1 text-[28px] font-semibold text-foreground tracking-tight">${Number(application.amount).toLocaleString()}</dd>
                      </div>
                      <div className="rounded-xl bg-secondary p-4">
                        <dt className="text-[13px] font-medium text-muted-foreground">Loan Type</dt>
                        <dd className="mt-1 text-[28px] font-semibold text-foreground capitalize tracking-tight">{application.loan_type}</dd>
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
                  const isDirectLead = !client && !!application.applicant_first_name;
                  const displayName = isDirectLead
                    ? [application.applicant_first_name, application.applicant_last_name].filter(Boolean).join(' ')
                    : client?.full_name;
                  const displayEmail = isDirectLead
                    ? (() => { try { return JSON.parse(application.lend_extra_data || '{}').applicant_email ?? null; } catch { return null; } })()
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

                      {/* Referrer Info */}
                      {referrer && (
                        <div className="mt-5 pt-5 border-t border-border">
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Referred By</h3>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-chart-4/15">
                              <span className="text-[12px] font-semibold text-chart-4">{referrer.full_name.charAt(0).toUpperCase()}</span>
                            </div>
                            <div>
                              <p className="text-[13px] font-semibold text-foreground">{referrer.full_name}</p>
                              <p className="text-[12px] text-muted-foreground">{referrer.email}</p>
                            </div>
                          </div>
                          {application.client_engagement_model && (
                            <div className="mt-3 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
                              <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Client Engagement</p>
                              <p className="text-[13px] font-medium text-foreground">
                                {application.client_engagement_model === 'self_managed'
                                  ? 'Referrer will manage the client relationship'
                                  : 'Broker may engage the client directly'}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </GlassCard>
                  );
                })()}

              </>
            )}

            {activeTab === 'documents' && (
              <>
                {/* Draft Actions (Required Docs & Submit) */}
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
                        <input
                          ref={fileInput}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={handleUploadDoc}
                          disabled={uploading}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="flex items-center justify-center gap-2 h-11 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors font-medium text-[13px]">
                          {uploading ? (
                            <><svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Uploading...</>
                          ) : (
                            <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg> Click to Upload</>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant={allDocsUploaded ? 'success' : 'primary'}
                      size="lg"
                      className="w-full"
                      onClick={handleBrokerSubmit}
                      disabled={submittingOnBehalf}
                      loading={submittingOnBehalf}
                    >
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
                              Requested by {req.requested_by_name} &middot; {new Date(req.created_at).toLocaleDateString()}
                              {req.status === 'fulfilled' && req.fulfilled_at && ` · Fulfilled ${new Date(req.fulfilled_at).toLocaleDateString()}`}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${req.status === 'fulfilled' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                            {req.status === 'fulfilled' ? 'Fulfilled' : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                )}

                {/* Documents */}
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
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              onChange={handleUploadDoc}
                              disabled={uploading}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <Button size="sm" variant="secondary" className="h-8 pointer-events-none" loading={uploading}>
                              {uploading ? 'Uploading...' : 'Upload'}
                            </Button>
                          </div>
                          <div className="h-4 w-[1px] bg-border" />
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8"
                        onClick={() => setShowDocRequestForm((v) => !v)}
                      >
                        <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        Request Docs
                      </Button>
                    </div>
                  </div>

                  {showDocRequestForm && (
                    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <p className="text-[13px] font-medium text-foreground mb-2">Specify which documents you need from the client</p>
                      <textarea
                        value={docRequestDescription}
                        onChange={(e) => setDocRequestDescription(e.target.value)}
                        placeholder="e.g. Last 3 months of bank statements, most recent payslip..."
                        rows={3}
                        className="w-full rounded-xl bg-background px-3.5 py-2.5 text-[13px] text-foreground border border-border/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                      />
                      <div className="flex items-center gap-2 mt-3">
                        <Button size="sm" variant="primary" onClick={handleSubmitDocRequest} disabled={!docRequestDescription.trim() || submittingDocRequest} loading={submittingDocRequest}>
                          Send Request
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowDocRequestForm(false); setDocRequestDescription(''); }}>
                          Cancel
                        </Button>
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

                            <button onClick={() => setPreviewDoc({ id: doc.id, filename: doc.original_filename, ocrStatus: doc.ocr_status })} className="led-btn led-btn-ghost led-btn-sm !px-1.5 hover:!text-[var(--led-info)] hover:!bg-[var(--led-info-tint)]" title="View Document">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            </button>
                            <button onClick={() => handleDownloadDoc(doc)} className="led-btn led-btn-ghost led-btn-sm !px-1.5" title="Download">
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

                {/* AI Document Analysis */}
                <AnalysisPanel
                  application={application}
                  documents={documents}
                  onStatusChange={refetchApplication}
                />

              </>
            )}

            {activeTab === 'overview' && (
              <>
                {/* Applicant Summary */}
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

              </>
            )}

            {activeTab === 'submissions' && (
              <>
                <GlassCard>
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-[15px] font-semibold text-foreground">Lender Submissions</h2>
                    {!showSubForm && (
                      <Button size="sm" onClick={() => { setSubForm({ lender_id: '', status: 'pending', offered_rate: '', offered_amount: '', conditions: '', notes: '' }); setEditingSubId(null); setShowSubForm(true); }}>
                        + Add Submission
                      </Button>
                    )}
                  </div>

                  {showSubForm && (
                    <div className="mb-5 p-4 rounded-xl border border-border/60 bg-secondary/20 space-y-3">
                      <h3 className="text-[14px] font-semibold text-foreground">{editingSubId ? 'Edit Submission' : 'New Submission'}</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {!editingSubId && (
                          <div>
                            <label className="block text-[12px] font-medium text-muted-foreground mb-1">Lender *</label>
                            <select
                              value={subForm.lender_id}
                              onChange={e => setSubForm(f => ({ ...f, lender_id: e.target.value }))}
                              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                              <option value="">Select lender...</option>
                              {availableLenders
                                .filter(l => !lenderSubmissions.some(s => s.lender_id === l.id) || (editingSubId && lenderSubmissions.find(s => s.id === editingSubId)?.lender_id === l.id))
                                .map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="block text-[12px] font-medium text-muted-foreground mb-1">Status</label>
                          <select
                            value={subForm.status}
                            onChange={e => setSubForm(f => ({ ...f, status: e.target.value }))}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="declined">Declined</option>
                            <option value="conditional">Conditional</option>
                            <option value="withdrawn">Withdrawn</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] font-medium text-muted-foreground mb-1">Offered Rate (%)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={subForm.offered_rate}
                            onChange={e => setSubForm(f => ({ ...f, offered_rate: e.target.value }))}
                            placeholder="e.g. 6.49"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] font-medium text-muted-foreground mb-1">Offered Amount ($)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={subForm.offered_amount}
                            onChange={e => setSubForm(f => ({ ...f, offered_amount: e.target.value }))}
                            placeholder="e.g. 500000"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Conditions</label>
                        <input
                          type="text"
                          value={subForm.conditions}
                          onChange={e => setSubForm(f => ({ ...f, conditions: e.target.value }))}
                          placeholder="Any conditions from the lender..."
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-muted-foreground mb-1">Notes</label>
                        <textarea
                          value={subForm.notes}
                          onChange={e => setSubForm(f => ({ ...f, notes: e.target.value }))}
                          rows={2}
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={savingSub}
                          onClick={async () => {
                            if (!editingSubId && !subForm.lender_id) { toast('Select a lender', 'error'); return; }
                            setSavingSub(true);
                            try {
                              if (editingSubId) {
                                const payload: Record<string, unknown> = { status: subForm.status };
                                if (subForm.offered_rate) payload.offered_rate = parseFloat(subForm.offered_rate);
                                else payload.offered_rate = null;
                                if (subForm.offered_amount) payload.offered_amount = parseFloat(subForm.offered_amount);
                                else payload.offered_amount = null;
                                payload.conditions = subForm.conditions || null;
                                payload.notes = subForm.notes || null;
                                if (subForm.status !== 'pending') payload.responded_at = new Date().toISOString();
                                const { data } = await api.patch(`/applications/${id}/submissions/${editingSubId}`, payload);
                                setLenderSubmissions(prev => prev.map(s => s.id === editingSubId ? data : s));
                                toast('Submission updated', 'success');
                              } else {
                                const payload: Record<string, unknown> = { lender_id: subForm.lender_id, status: subForm.status };
                                if (subForm.offered_rate) payload.offered_rate = parseFloat(subForm.offered_rate);
                                if (subForm.offered_amount) payload.offered_amount = parseFloat(subForm.offered_amount);
                                if (subForm.conditions) payload.conditions = subForm.conditions;
                                if (subForm.notes) payload.notes = subForm.notes;
                                const { data } = await api.post(`/applications/${id}/submissions`, payload);
                                setLenderSubmissions(prev => [data, ...prev]);
                                toast('Submission created', 'success');
                              }
                              setShowSubForm(false);
                              setEditingSubId(null);
                            } catch (err) {
                              toast(getErrorMessage(err, 'Failed to save submission'), 'error');
                            } finally {
                              setSavingSub(false);
                            }
                          }}
                        >
                          {editingSubId ? 'Save' : 'Submit'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowSubForm(false); setEditingSubId(null); }}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {lenderSubmissions.length === 0 && !showSubForm ? (
                    <p className="text-muted-foreground text-[14px] text-center py-8">No lender submissions yet. Click "Add Submission" to record one.</p>
                  ) : (
                    <div className="space-y-3">
                      {lenderSubmissions.map(sub => (
                        <div key={sub.id} className="rounded-xl border border-border/60 p-4 hover:bg-secondary/20 transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[15px] font-semibold text-foreground">{sub.lender_name}</span>
                                <Badge type="custom" value={SUBMISSION_STATUS_BADGE[sub.status as LenderSubmissionStatus]?.label || sub.status} className={SUBMISSION_STATUS_BADGE[sub.status as LenderSubmissionStatus]?.className || 'bg-secondary text-muted-foreground'} />
                              </div>
                              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[13px] text-muted-foreground mt-2">
                                <div>Submitted: {formatDate(sub.submitted_at)}</div>
                                {sub.responded_at && <div>Responded: {formatDate(sub.responded_at)}</div>}
                                {sub.offered_rate != null && <div>Rate: {sub.offered_rate}%</div>}
                                {sub.offered_amount != null && <div>Amount: ${Number(sub.offered_amount).toLocaleString()}</div>}
                                {sub.conditions && <div className="sm:col-span-2">Conditions: {sub.conditions}</div>}
                                {sub.notes && <div className="sm:col-span-2">Notes: {sub.notes}</div>}
                              </div>
                              <div className="text-[12px] text-muted-foreground/60 mt-1">By {sub.submitted_by_name}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSubForm({
                                    lender_id: sub.lender_id,
                                    status: sub.status,
                                    offered_rate: sub.offered_rate != null ? String(sub.offered_rate) : '',
                                    offered_amount: sub.offered_amount != null ? String(sub.offered_amount) : '',
                                    conditions: sub.conditions || '',
                                    notes: sub.notes || '',
                                  });
                                  setEditingSubId(sub.id);
                                  setShowSubForm(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={async () => {
                                  try {
                                    await api.delete(`/applications/${id}/submissions/${sub.id}`);
                                    setLenderSubmissions(prev => prev.filter(s => s.id !== sub.id));
                                    toast('Submission deleted', 'success');
                                  } catch (err) {
                                    toast(getErrorMessage(err, 'Failed to delete submission'), 'error');
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              </>
            )}
            {activeTab === 'messages' && (
              <>
                <GlassCard>
                  {/* Tab bar */}
                  <div className="flex items-center gap-1 border-b border-border pb-4 mb-4 bg-secondary/50 rounded-xl p-1">
                    {([
                      { key: 'client_messages' as const, label: 'Client Messages' },
                      { key: 'deal_notes' as const, label: 'Deal Notes' },
                      { key: 'alerts' as const, label: 'Alerts' },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setMsgTab(key)}
                        className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-200 ${msgTab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-background/50'}`}
                      >
                        {label}
                        {key === 'alerts' && alerts.length > 0 && (
                          <span className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded-full bg-destructive/20 text-destructive text-[10px] font-bold">{alerts.length}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Client Messages tab */}
                  {msgTab === 'client_messages' && (
                    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
                      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
                        {clientMessages.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                            <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                              <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                            </div>
                            <p className="text-[13px] font-medium text-muted-foreground">No messages yet</p>
                          </div>
                        ) : (
                          clientMessages.map((msg) => (
                            <div key={msg.id} className="flex flex-col gap-1.5 group/msg">
                              <div className="flex items-baseline justify-between px-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-semibold text-foreground">{msg.author_name || 'Staff'}</span>
                                  {msg.author_role && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground capitalize uppercase tracking-wider">{msg.author_role}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={async () => {
                                      if (!client?.id) return;
                                      try {
                                        await api.delete(`/clients/${client.id}/messages/${msg.id}`);
                                        setClientMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                        toast('Message deleted', 'success');
                                      } catch (err: unknown) {
                                        toast(getErrorMessage(err, 'Failed to delete'), 'error');
                                      }
                                    }}
                                    className="opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    title="Delete"
                                  >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                  </button>
                                  <span className="text-[11px] font-medium text-muted-foreground">{formatDate(msg.created_at)} &middot; {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                              </div>
                              <div className="rounded-2xl p-3.5 text-[14px] leading-relaxed bg-primary/10 text-primary border border-primary/20">
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-primary/50 focus-within:bg-secondary/60 transition-all duration-300 flex flex-col pt-1">
                        <textarea
                          value={newClientMsgContent}
                          onChange={(e) => setNewClientMsgContent(e.target.value)}
                          rows={2}
                          className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
                          placeholder="Write a message to the client..."
                        />
                        <div className="flex items-center justify-end px-3 pb-3 pt-1 border-t border-border/30 mt-1">
                          <Button
                            size="sm"
                            className="rounded-xl px-4 h-9"
                            loading={sendingClientMsg}
                            disabled={!newClientMsgContent.trim() || !client?.id}
                            onClick={async () => {
                              if (!client?.id || !newClientMsgContent.trim()) return;
                              setSendingClientMsg(true);
                              try {
                                const { data } = await api.post(`/clients/${client.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: client.id });
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
                    </div>
                  )}

                  {/* Deal Notes tab */}
                  {msgTab === 'deal_notes' && (
                    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
                      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
                        {appNotes.filter((n) => n.visibility.length === 1 && n.visibility[0] === 'broker').length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                            <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                              <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                            </div>
                            <p className="text-[13px] font-medium text-muted-foreground">No deal notes yet</p>
                          </div>
                        ) : (
                          appNotes
                            .filter((n) => n.visibility.length === 1 && n.visibility[0] === 'broker')
                            .map((note) => (
                              <div key={note.id} className="flex flex-col gap-1.5 group/note">
                                <div className="flex items-baseline justify-between px-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-semibold text-foreground">{note.author_name || 'Staff'}</span>
                                    {note.author_role && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground capitalize uppercase tracking-wider">{note.author_role}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={async () => {
                                        if (!id) return;
                                        try {
                                          await api.delete(`/applications/${id}/notes/${note.id}`);
                                          setAppNotes((prev) => prev.filter((n) => n.id !== note.id));
                                          toast('Note deleted', 'success');
                                        } catch (err: unknown) {
                                          toast(getErrorMessage(err, 'Failed to delete'), 'error');
                                        }
                                      }}
                                      className="opacity-0 group-hover/note:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                      title="Delete"
                                    >
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                    </button>
                                    <span className="text-[11px] font-medium text-muted-foreground">{formatDate(note.created_at)} &middot; {new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                </div>
                                <div className="rounded-2xl p-3.5 text-[14px] leading-relaxed bg-secondary/40 text-foreground border border-transparent">
                                  <p className="whitespace-pre-wrap">{note.content}</p>
                                  <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border/30">
                                    <svg className="h-3.5 w-3.5 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                    <span className="text-[11px] font-medium opacity-60">Internal (Brokers only)</span>
                                  </div>
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                      <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-primary/50 focus-within:bg-secondary/60 transition-all duration-300 flex flex-col pt-1">
                        <textarea
                          value={newNoteContent}
                          onChange={(e) => setNewNoteContent(e.target.value)}
                          rows={2}
                          className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
                          placeholder="Write an internal note..."
                        />
                        <div className="flex items-center justify-end px-3 pb-3 pt-1 border-t border-border/30 mt-1">
                          <Button
                            size="sm"
                            className="rounded-xl px-4 h-9"
                            loading={sendingNote}
                            disabled={!newNoteContent.trim()}
                            onClick={async () => {
                              if (!id || !newNoteContent.trim()) return;
                              setSendingNote(true);
                              try {
                                const { data } = await api.post(`/applications/${id}/notes`, { content: newNoteContent.trim(), visibility: ['broker'] });
                                setAppNotes((prev) => [...prev, data]);
                                setNewNoteContent('');
                                toast('Deal note added', 'success');
                              } catch (err: unknown) {
                                toast(getErrorMessage(err, 'Failed to save note'), 'error');
                              } finally {
                                setSendingNote(false);
                              }
                            }}
                          >
                            <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                            Add Note
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Alerts tab */}
                  {msgTab === 'alerts' && (
                    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
                      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
                        {alerts.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                            <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                              <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                            </div>
                            <p className="text-[13px] font-medium text-muted-foreground">No alerts for this client</p>
                          </div>
                        ) : (
                          alerts.map((alert) => (
                            <div key={alert.id} className="flex flex-col gap-1.5 group/alert">
                              <div className="flex items-baseline justify-between px-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-semibold text-foreground">{alert.author_name || 'Staff'}</span>
                                  {alert.author_role && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground capitalize uppercase tracking-wider">{alert.author_role}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={async () => {
                                      if (!client?.id) return;
                                      try {
                                        await api.delete(`/clients/${client.id}/alerts/${alert.id}`);
                                        setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
                                        toast('Alert deleted', 'success');
                                      } catch (err: unknown) {
                                        toast(getErrorMessage(err, 'Failed to delete'), 'error');
                                      }
                                    }}
                                    className="opacity-0 group-hover/alert:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    title="Delete"
                                  >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                  </button>
                                  <span className="text-[11px] font-medium text-muted-foreground">{formatDate(alert.created_at)} &middot; {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                              </div>
                              <div className="rounded-2xl p-3.5 text-[14px] leading-relaxed bg-destructive/8 text-foreground border border-destructive/20">
                                <p className="whitespace-pre-wrap">{alert.content}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-destructive/50 focus-within:bg-secondary/60 transition-all duration-300 flex flex-col pt-1">
                        <textarea
                          value={newAlertContent}
                          onChange={(e) => setNewAlertContent(e.target.value)}
                          rows={2}
                          className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
                          placeholder="Add a client alert (internal only)..."
                        />
                        <div className="flex items-center justify-end px-3 pb-3 pt-1 border-t border-border/30 mt-1">
                          <Button
                            size="sm"
                            variant="danger"
                            className="rounded-xl px-4 h-9"
                            loading={sendingAlert}
                            disabled={!newAlertContent.trim() || !client?.id}
                            onClick={async () => {
                              if (!client?.id || !newAlertContent.trim()) return;
                              setSendingAlert(true);
                              try {
                                const { data } = await api.post(`/clients/${client.id}/alerts`, { content: newAlertContent.trim() });
                                setAlerts((prev) => [...prev, data]);
                                setNewAlertContent('');
                                toast('Alert added', 'success');
                              } catch (err: unknown) {
                                toast(getErrorMessage(err, 'Failed to add alert'), 'error');
                              } finally {
                                setSendingAlert(false);
                              }
                            }}
                          >
                            <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                            Add Alert
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </GlassCard>
              </>
            )}

            {activeTab === 'quotes' && (
              <>
                {/* Quote Form / Editor */}
                {(showQuoteForm || editingQuoteSheet) ? (
                  <QuoteSheetEditor
                    applicationId={id!}
                    quoteSheet={editingQuoteSheet || undefined}
                    onSave={(sheet) => {
                      setQuoteSheets(prev => {
                        const idx = prev.findIndex(s => s.id === sheet.id);
                        if (idx >= 0) return prev.map(s => s.id === sheet.id ? sheet : s);
                        return [...prev, sheet];
                      });
                      setShowQuoteForm(false);
                      setEditingQuoteSheet(null);
                    }}
                    onCancel={() => { setShowQuoteForm(false); setEditingQuoteSheet(null); }}
                  />
                ) : viewingQuoteSheet ? (
                  <GlassCard key={`view-${viewingQuoteSheet.id}-${viewKeyRef.current}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setViewingQuoteSheet(null)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                        </button>
                        <h3 className="text-[15px] font-semibold">
                          {viewingQuoteSheet.title || `Quote Sheet v${viewingQuoteSheet.version}`}
                        </h3>
                        <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${QUOTE_SHEET_STATUS_BADGE[viewingQuoteSheet.status].className}`}>
                          {QUOTE_SHEET_STATUS_BADGE[viewingQuoteSheet.status].label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDownloadPdf(viewingQuoteSheet, false)}
                        >
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            PDF
                          </span>
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleDownloadPdf(viewingQuoteSheet, true)}
                        >
                          Client PDF
                        </Button>
                      </div>
                    </div>
                    <QuoteSheetComparison quoteSheet={viewingQuoteSheet} showBrokerNotes />
                  </GlassCard>
                ) : (
                  <GlassCard>
                    <div className="flex items-center justify-between mb-5">
                      <h2 className="text-[15px] font-semibold text-foreground">Quote Sheets</h2>
                      <Button size="sm" onClick={() => { setShowQuoteForm(true); setViewingQuoteSheet(null); setEditingQuoteSheet(null); }}>
                        <span className="flex items-center gap-1.5">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                          Create Quote Sheet
                        </span>
                      </Button>
                    </div>

                    {quoteSheets.length === 0 ? (
                      <div className="rounded-xl bg-secondary/50 p-8 text-center">
                        <svg className="mx-auto h-10 w-10 text-muted-foreground mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                        <p className="text-[14px] font-medium text-muted-foreground">No quote sheets yet</p>
                        <p className="text-[12px] text-muted-foreground mt-1">Create a quote sheet to compare lender options for this application</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[...quoteSheets].sort((a, b) => b.version - a.version).map(sheet => (
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
                                <div className="flex items-center gap-2 mt-1">
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
                                onClick={() => { viewKeyRef.current++; setViewingQuoteSheet(sheet); setEditingQuoteSheet(null); setShowQuoteForm(false); }}
                                className="rounded-lg bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
                              >
                                View
                              </button>
                              {sheet.status === 'draft' && (
                                <button
                                  onClick={() => { setEditingQuoteSheet(sheet); setShowQuoteForm(false); setViewingQuoteSheet(null); }}
                                  className="rounded-lg bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-secondary/80 transition-colors"
                                >
                                  Edit
                                </button>
                              )}
                              {sheet.status === 'draft' && (
                                <button
                                  onClick={() => {
                                    // Extract available term years from sheet options
                                    const terms = [...new Set(sheet.options.map(o => Math.round((o.loan_term_months ?? 0) / 12)))];
                                    const displayOrder = [5, 4, 3, 2, 7];
                                    terms.sort((a, b) => {
                                      const ai = displayOrder.indexOf(a);
                                      const bi = displayOrder.indexOf(b);
                                      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                                    });
                                    setSendModalTerms(terms);
                                    setSendModalSheet(sheet);
                                  }}
                                  className="rounded-lg bg-success/10 px-3 py-1.5 text-[12px] font-medium text-success hover:bg-success/20 transition-colors"
                                >
                                  Send to Client
                                </button>
                              )}

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
                                      await api.delete(`/applications/${id}/quote-sheets/${sheet.id}`);
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

                {/* On-demand off-screen render for PDF capture */}
                {pdfRenderSheet && (
                  <div style={{ position: 'fixed', left: '-9999px', top: 0, width: '794px', background: 'white', padding: '24px' }}>
                    <div id={`quote-sheet-pdf-${pdfRenderSheet.sheet.id}`}>
                      <QuoteSheetComparison
                        quoteSheet={pdfRenderSheet.sheet}
                        isPdfExport={true}
                        isClientView={pdfRenderSheet.clientFacing}
                        clientName={client?.full_name}
                        applicationRef={application?.id ? application.id.split('-')[0].toUpperCase() : undefined}
                      />
                    </div>
                  </div>
                )}

                {/* Send to Client Modal */}
                {sendModalSheet && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-card rounded-2xl shadow-xl border border-border w-full max-w-md mx-4 p-6">
                      <h3 className="text-lg font-semibold text-foreground mb-1">Send Quote to Client</h3>
                      <p className="text-sm text-muted-foreground mb-5">Select which term years to include in the client's quote sheet.</p>

                      <div className="space-y-2.5 mb-6">
                        {(() => {
                          const allTerms = [...new Set(sendModalSheet.options.map(o => Math.round((o.loan_term_months ?? 0) / 12)))];
                          const displayOrder = [5, 4, 3, 2, 7];
                          allTerms.sort((a, b) => {
                            const ai = displayOrder.indexOf(a);
                            const bi = displayOrder.indexOf(b);
                            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                          });
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
                              <span className="text-sm font-medium text-foreground">{term} Year Term</span>
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
                              // Update input_parameters with selected_terms
                              let inputParams: Record<string, unknown> = {};
                              if (sendModalSheet.input_parameters) {
                                try { inputParams = JSON.parse(sendModalSheet.input_parameters); } catch { /* empty */ }
                              }
                              inputParams.selected_terms = sendModalTerms;

                              await api.patch(`/applications/${id}/quote-sheets/${sendModalSheet.id}`, {
                                status: 'sent',
                                input_parameters: JSON.stringify(inputParams),
                              });
                              const { data } = await api.get(`/applications/${id}/quote-sheets`);
                              setQuoteSheets(data);
                              toast('Quote sheet sent to client', 'success');
                              setSendModalSheet(null);
                            } catch (err) {
                              toast(getErrorMessage(err, 'Failed to send'), 'error');
                            } finally {
                              setSendingQuote(false);
                            }
                          }}
                        >
                          Send ({sendModalTerms.length} term{sendModalTerms.length !== 1 ? 's' : ''})
                        </Button>
                        <Button variant="secondary" onClick={() => setSendModalSheet(null)} disabled={sendingQuote}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === 'activity' && (
              <GlassCard padding="none">
                <div className="px-6 py-4 border-b border-border">
                  <h2 className="text-[15px] font-semibold text-foreground">Activity</h2>
                  <p className="text-[13px] text-muted-foreground mt-0.5">All actions recorded for this application</p>
                </div>
                {activityLoading ? (
                  <div className="p-6 space-y-4">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-xl shimmer shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-40 rounded-lg shimmer" />
                          <div className="h-3 w-56 rounded-lg shimmer" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : activityLogs.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                      <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                    </div>
                    <p className="text-[14px] text-muted-foreground font-medium">No activity recorded yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {activityLogs.map(log => {
                      let details: Record<string, string> = {};
                      try { if (log.details) details = JSON.parse(log.details); } catch { }
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
            )}
          </div>
        </div>

        {/* Sidebar Actions */}
        <div className="space-y-6 sticky top-6">
          {/* Status Actions */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-4">Actions</h2>
            {allowedTransitions.length === 0 ? (
              <div className="rounded-xl bg-secondary p-4 text-center">
                <p className="text-[13px] text-muted-foreground">No transitions available</p>
                <p className="text-[12px] text-muted-foreground mt-1">Status: {application.status}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[13px] font-medium text-muted-foreground mb-3">Change status to</p>
                {allowedTransitions.map((s) => (
                  <Button
                    key={s}
                    variant={s === 'settled' || s === 'approval' ? 'success' : s === 'rejected' || s === 'not_proceeding' ? 'danger' : 'primary'}
                    size="lg"
                    className="w-full capitalize"
                    onClick={() => handleStatusChange(s)}
                  >
                    {s.replace(/_/g, ' ')}
                  </Button>
                ))}
              </div>
            )}
          </GlassCard>



          {/* Broker Assignment */}
          {currentUser?.role === 'admin' && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-4">Assigned Brokers</h2>
              {brokers.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No brokers available</p>
              ) : (
                <div>
                  {application.assigned_brokers.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {application.assigned_brokers.map((ab) => (
                        <div key={ab.id} className="flex items-center gap-3 rounded-xl bg-primary/10 p-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                            <span className="text-[11px] font-semibold text-primary-foreground">
                              {getInitials(ab.full_name)}
                            </span>
                          </div>
                          <p className="text-[13px] font-semibold text-primary flex-1">{ab.full_name}</p>
                          <button
                            onClick={() => handleUnassignBroker(ab.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                            title="Remove broker"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      if (val.startsWith('group:')) {
                        handleAssignGroup(val.slice(6));
                      } else {
                        handleAssignBroker(val);
                      }
                    }}
                    className="led-input"
                    style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
                  >
                    <option value="">Assign broker or group...</option>
                    {brokerGroups.length > 0 && (
                      <optgroup label="Broker Groups">
                        {brokerGroups.map((g) => (
                          <option key={`g-${g.id}`} value={`group:${g.id}`}>
                            {g.name} ({g.members.length} member{g.members.length !== 1 ? 's' : ''})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Individual Brokers">
                      {brokers
                        .filter((b) => !application.assigned_brokers.some((ab) => ab.id === b.id))
                        .map((b) => (
                          <option key={b.id} value={b.id}>{b.full_name}</option>
                        ))}
                    </optgroup>
                  </select>
                </div>
              )}
            </GlassCard>
          )}
        </div>
      </div>

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
        open={!!pendingStatus}
        title="Change application status?"
        message={pendingStatus ? (
          <>
            This will update the application to <span className="font-semibold text-foreground capitalize">{pendingStatusLabel}</span>.
          </>
        ) : null}
        confirmText="Change Status"
        cancelText="Cancel"
        variant={pendingStatus === 'rejected' || pendingStatus === 'not_proceeding' ? 'danger' : pendingStatus === 'approval' || pendingStatus === 'settled' ? 'success' : 'primary'}
        loading={changingStatus}
        onConfirm={confirmStatusChange}
        onCancel={() => {
          if (!changingStatus) setPendingStatus(null);
        }}
      />

      <ConfirmDialog
        open={confirmBrokerSubmit}
        title="Submit this application now?"
        message="The draft will be submitted and its status will change to Application Received."
        confirmText="Submit Application"
        cancelText="Cancel"
        variant="primary"
        loading={submittingOnBehalf}
        onConfirm={confirmBrokerSubmitAction}
        onCancel={() => {
          if (!submittingOnBehalf) setConfirmBrokerSubmit(false);
        }}
      />
    </div>
  );
}
