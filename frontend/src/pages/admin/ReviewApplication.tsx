import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client';
import AnalysisPanel from '../../components/AnalysisPanel';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useBrokerAssignment } from '../../hooks/useBrokerAssignment';
import { useFileDownload } from '../../hooks/useFileDownload';
import { GlassCard, Badge, Button } from '../../components/ui';
import { getErrorMessage, formatDate, getInitials } from '../../lib/utils';
import { DOC_TYPE_LABELS, LEND_SYNC_BADGE, OCR_STATUS_BADGE, REQUIRED_DOC_TYPES, VALID_TRANSITIONS } from '../../lib/constants';
import type { ApplicationNote, DocType, Document, LendSyncStatus, LoanApplication, LoanType, User } from '../../types';

export default function ReviewApplication() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { assignBroker, unassignBroker } = useBrokerAssignment();
  const { downloadFile } = useFileDownload();

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [client, setClient] = useState<User | null>(null);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [appNotes, setAppNotes] = useState<ApplicationNote[]>([]);
  const [noteTab, setNoteTab] = useState<'internal' | 'client'>('internal');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);
  const [retryingOcr, setRetryingOcr] = useState<string | null>(null);

  // Broker edit draft state
  const [editLoanType, setEditLoanType] = useState<LoanType>('personal');
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingFields, setSavingFields] = useState(false);
  const [submittingOnBehalf, setSubmittingOnBehalf] = useState(false);
  const [docType, setDocType] = useState<DocType>('id_proof');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Lend integration state
  const [lendEnabled, setLendEnabled] = useState(false);
  const [lendProductTypeId, setLendProductTypeId] = useState('');
  const [lendOwnerType, setLendOwnerType] = useState('');
  const [lendSendType, setLendSendType] = useState('Manual');
  const [lendWhoToContact, setLendWhoToContact] = useState('Broker');
  const [savingLend, setSavingLend] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [docLendTypes, setDocLendTypes] = useState<Record<string, string>>({});
  const [showLendDetails, setShowLendDetails] = useState(false);

  // Editable lead fields (applicant + business + loan)
  const [leadFields, setLeadFields] = useState({
    applicant_title: '', applicant_first_name: '', applicant_last_name: '', applicant_middle_name: '',
    applicant_dob: '', applicant_gender: '', applicant_marital_status: '',
    applicant_address: '', applicant_suburb: '', applicant_state: '', applicant_postcode: '',
    business_name: '', business_abn: '', business_registration_date: '', business_industry_id: '',
    business_monthly_sales: '', loan_term_requested: '', loan_purpose_id: '', amount: '',
  });
  const updateLeadField = (field: string, value: string) => setLeadFields((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!id) return;
    // Check Lend config
    api.get('/lend/config').then(({ data }) => setLendEnabled(data.enabled)).catch(() => {});

    Promise.all([
      api.get(`/applications/${id}`),
      api.get(`/documents/application/${id}`),
      api.get('/users'),
      api.get(`/applications/${id}/notes`),
    ])
      .then(([appRes, docRes, usersRes, notesRes]) => {
        setApplication(appRes.data);
        setDocuments(docRes.data);
        setNotes(appRes.data.notes || '');
        setAppNotes(notesRes.data);
        // Init broker edit fields
        setEditLoanType(appRes.data.loan_type);
        setEditAmount(String(appRes.data.amount));
        setEditNotes(appRes.data.notes || '');
        // Init Lend fields
        setLendProductTypeId(appRes.data.lend_product_type_id ? String(appRes.data.lend_product_type_id) : '');
        setLendOwnerType(appRes.data.lend_owner_type || '');
        setLendSendType(appRes.data.lend_send_type || 'Manual');
        setLendWhoToContact(appRes.data.lend_who_to_contact || 'Broker');
        // Init editable lead fields
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
          loan_term_requested: d.loan_term_requested ? String(d.loan_term_requested) : '',
          loan_purpose_id: d.loan_purpose_id ? String(d.loan_purpose_id) : '',
          amount: d.amount ? String(d.amount) : '',
        });
        // Init doc lend types
        const dtMap: Record<string, string> = {};
        docRes.data.forEach((d: Document) => { if (d.lend_document_type) dtMap[d.id] = d.lend_document_type; });
        setDocLendTypes(dtMap);

        const clientUser = usersRes.data.find((u: User) => u.id === appRes.data.user_id);
        setClient(clientUser || null);
        setBrokers(usersRes.data.filter((u: User) => u.role === 'broker'));
      })
      .catch(() => toast('Failed to load application', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const refetchApplication = async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/applications/${id}`);
      setApplication(data);
    } catch { /* ignore */ }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id) return;
    try {
      const { data } = await api.patch(`/applications/${id}/status?status=${newStatus}`);
      setApplication(data);
      toast(`Status changed to ${newStatus}`, 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to change status'), 'error');
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

  const handleSaveNotes = async () => {
    if (!id) return;
    try {
      const { data } = await api.patch(`/applications/${id}`, { notes });
      setApplication(data);
      toast('Notes saved', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to save notes'), 'error');
    }
  };

  const handleDownloadDoc = (doc: Document) => downloadFile(doc.id, doc.original_filename);

  const handleVerifyDoc = async (docId: string) => {
    try {
      const { data } = await api.patch(`/documents/${docId}/verify`);
      setDocuments((prev) => prev.map((d) => (d.id === docId ? data : d)));
      toast('Document verified', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to verify'), 'error');
    }
  };

  const handleSaveFields = async () => {
    if (!id) return;
    setSavingFields(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, {
        loan_type: editLoanType,
        amount: parseFloat(editAmount),
        notes: editNotes || null,
      });
      setApplication(data);
      setNotes(data.notes || '');
      toast('Application fields saved', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to save fields'), 'error');
    } finally {
      setSavingFields(false);
    }
  };

  const handleBrokerSubmit = async () => {
    if (!id) return;
    setSubmittingOnBehalf(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, { status: 'submitted' });
      setApplication(data);
      toast('Application submitted on behalf of client', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to submit'), 'error');
    } finally {
      setSubmittingOnBehalf(false);
    }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      const { data } = await api.post(`/documents/upload/${id}?doc_type=${docType}`, formData);
      setDocuments((prev) => [...prev, data]);
      toast('Document uploaded', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleRetryOcr = async (docId: string) => {
    setRetryingOcr(docId);
    try {
      await api.post(`/documents/${docId}/retry-ocr`);
      setDocuments((prev) => prev.map((d) => d.id === docId ? { ...d, ocr_status: 'pending' as const } : d));
      toast('OCR restarted', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to restart OCR'), 'error');
    } finally {
      setRetryingOcr(null);
    }
  };

  const handleSaveLendFields = async () => {
    if (!id) return;
    setSavingLend(true);
    try {
      const { data } = await api.patch(`/applications/${id}`, {
        lend_product_type_id: lendProductTypeId ? parseInt(lendProductTypeId) : null,
        lend_owner_type: lendOwnerType || null,
        lend_send_type: lendSendType,
        lend_who_to_contact: lendWhoToContact,
        // Lead detail overrides
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
        loan_term_requested: leadFields.loan_term_requested ? parseInt(leadFields.loan_term_requested) : null,
        loan_purpose_id: leadFields.loan_purpose_id ? parseInt(leadFields.loan_purpose_id) : null,
        amount: leadFields.amount ? parseFloat(leadFields.amount) : undefined,
      });
      setApplication(data);
      toast('Lend settings saved', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save Lend settings'), 'error');
    } finally {
      setSavingLend(false);
    }
  };

  const handleLendSync = async () => {
    if (!id) return;
    setSyncing(true);
    try {
      await api.post(`/lend/sync/${id}`);
      toast('Lend sync started', 'success');
      // Poll for status
      setTimeout(async () => {
        try {
          const { data } = await api.get(`/lend/status/${id}`);
          setApplication((prev) => prev ? { ...prev, ...data } : prev);
        } catch { /* ignore */ }
        setSyncing(false);
      }, 3000);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to start sync'), 'error');
      setSyncing(false);
    }
  };

  const handleDocLendTypeChange = async (docId: string, lendDocType: string) => {
    setDocLendTypes((prev) => ({ ...prev, [docId]: lendDocType }));
    try {
      await api.patch(`/lend/documents/${docId}`, { lend_document_type: lendDocType || null });
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to set document type'), 'error');
    }
  };

  const isDraft = application?.status === 'draft';
  const uploadedDocTypes = new Set(documents.map((d) => d.doc_type));
  const missingDocs = REQUIRED_DOC_TYPES.filter((t) => !uploadedDocTypes.has(t));
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
              <Badge value={application.status} />
            </div>
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
          </GlassCard>

          {/* Edit & Complete Draft (broker/admin only) */}
          {isDraft && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Edit & Complete Application</h2>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-2">Loan Type</label>
                    <select
                      value={editLoanType}
                      onChange={(e) => setEditLoanType(e.target.value as LoanType)}
                      className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="personal">Personal</option>
                      <option value="home">Home</option>
                      <option value="business">Business</option>
                      <option value="vehicle">Vehicle</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-2">Amount ($)</label>
                    <input
                      type="number"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="Enter amount"
                    />
                  </div>
                </div>
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
                <Button onClick={handleSaveFields} loading={savingFields}>Save Changes</Button>
              </div>

              {/* Required Documents Checklist */}
              <div className="mt-6 pt-5 border-t border-border">
                <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Required Documents</h3>
                <div className="grid gap-2 sm:grid-cols-2 mb-4">
                  {REQUIRED_DOC_TYPES.map((type) => (
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

                {/* Upload widget */}
                <div className="rounded-xl bg-secondary/50 p-4 mb-4">
                  <label className="block text-[13px] font-medium text-muted-foreground mb-2">Upload Document</label>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value as DocType)}
                      className="rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-11 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleUploadDoc}
                      disabled={uploading}
                      className="flex-1 text-[13px] text-muted-foreground file:mr-4 file:rounded-xl file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-primary hover:file:bg-primary/20 file:transition-colors file:cursor-pointer"
                    />
                  </div>
                  {uploading && (
                    <div className="flex items-center gap-2 mt-2 text-primary">
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      <span className="text-[13px] font-medium">Uploading...</span>
                    </div>
                  )}
                </div>

                <Button
                  variant={allDocsUploaded ? 'success' : 'secondary'}
                  size="lg"
                  className="w-full"
                  onClick={handleBrokerSubmit}
                  disabled={!allDocsUploaded || submittingOnBehalf}
                  loading={submittingOnBehalf}
                >
                  {allDocsUploaded ? 'Submit on Behalf of Client' : `${missingDocs.length} document${missingDocs.length > 1 ? 's' : ''} still required`}
                </Button>
              </div>
            </GlassCard>
          )}

          {/* Client Info */}
          {client && (
            <GlassCard>
              <h2 className="text-[15px] font-semibold text-foreground mb-5">Client Information</h2>
              <div className="flex items-center gap-4 mb-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
                  <span className="text-[15px] font-semibold text-primary-foreground">{client.full_name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">{client.full_name}</p>
                  <p className="text-[13px] text-muted-foreground">{client.email}</p>
                </div>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-[13px] font-medium text-muted-foreground">Phone</dt>
                  <dd className="mt-1 text-[14px] font-medium text-foreground">{client.phone || 'Not provided'}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-medium text-muted-foreground">KYC Status</dt>
                  <dd className="mt-1"><Badge type="kyc" value={client.kyc_status} /></dd>
                </div>
              </dl>
            </GlassCard>
          )}

          {/* Documents */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-5">Documents</h2>
            {documents.length === 0 ? (
              <div className="rounded-xl bg-secondary/50 p-6 text-center">
                <svg className="mx-auto h-8 w-8 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                <p className="text-[14px] text-muted-foreground">No documents uploaded</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                   <div key={doc.id} className="flex items-center gap-4 rounded-xl bg-secondary/30 p-4 transition-all duration-200 hover:bg-secondary/50" style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-foreground">{doc.original_filename}</p>
                      <p className="text-[12px] text-muted-foreground">{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type} &middot; {formatDate(doc.uploaded_at)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {doc.ocr_status && (
                        <Badge type="custom" value={OCR_STATUS_BADGE[doc.ocr_status].label} className={OCR_STATUS_BADGE[doc.ocr_status].className} />
                      )}
                      {doc.ocr_status && (doc.ocr_status === 'failed' || doc.ocr_status === 'completed') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRetryOcr(doc.id)}
                          disabled={retryingOcr === doc.id}
                        >
                          {retryingOcr === doc.id ? 'Retrying...' : 'Redo OCR'}
                        </Button>
                      )}
                      {doc.is_verified ? (
                        <Badge type="custom" value="Verified" className="bg-success/10 text-success" />
                      ) : (
                        <Button variant="success" size="sm" onClick={() => handleVerifyDoc(doc.id)}>Verify</Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setPreviewDoc({ id: doc.id, filename: doc.original_filename, ocrStatus: doc.ocr_status })}>View</Button>
                      <Button variant="secondary" size="sm" onClick={() => handleDownloadDoc(doc)}>Download</Button>
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

          {/* Lend.com.au Integration */}
          {lendEnabled && !isDraft && (
            <GlassCard>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[15px] font-semibold text-foreground">Lend.com.au</h2>
                {application.lend_sync_status && LEND_SYNC_BADGE[application.lend_sync_status as LendSyncStatus] && (
                  <Badge type="custom" value={LEND_SYNC_BADGE[application.lend_sync_status as LendSyncStatus].label} className={LEND_SYNC_BADGE[application.lend_sync_status as LendSyncStatus].className} />
                )}
              </div>

              {/* Sync status info */}
              {application.lend_ref && (
                <div className="mb-4 rounded-xl bg-success/5 border border-success/20 px-4 py-2.5">
                  <span className="text-[13px] font-medium text-success">Lend Ref: {application.lend_ref}</span>
                  {application.lend_synced_at && (
                    <span className="text-[12px] text-success/70 ml-3">Synced: {formatDate(application.lend_synced_at)}</span>
                  )}
                </div>
              )}
              {application.lend_sync_error && (
                <div className="mb-4 rounded-xl bg-destructive/5 border border-destructive/20 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <svg className="h-4 w-4 text-destructive shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                    <div>
                      <p className="text-[13px] font-semibold text-destructive mb-1">Sync Failed</p>
                      {application.lend_sync_error.includes(';') ? (
                        <ul className="list-disc list-inside space-y-0.5">
                          {application.lend_sync_error.split(';').map((err, i) => (
                            <li key={i} className="text-[12px] text-destructive/90">{err.trim()}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-destructive/90">{application.lend_sync_error}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Editable lead details */}
              <button
                type="button"
                onClick={() => setShowLendDetails(!showLendDetails)}
                className="flex items-center justify-between w-full rounded-xl bg-secondary/50 hover:bg-secondary px-4 py-2.5 mb-4 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                  <span className="text-[13px] font-medium text-foreground">Edit Lead Details</span>
                </div>
                <svg className={`h-4 w-4 text-muted-foreground transition-transform ${showLendDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
              </button>
              {showLendDetails && (
                <div className="space-y-4 mb-5 rounded-xl bg-secondary/30 p-4">
                  {/* Applicant */}
                  <h3 className="text-[13px] font-medium text-muted-foreground">Applicant</h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Title</label>
                      <select value={leadFields.applicant_title} onChange={(e) => updateLeadField('applicant_title', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="">Select...</option>
                        {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">First Name</label>
                      <input type="text" value={leadFields.applicant_first_name} onChange={(e) => updateLeadField('applicant_first_name', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Middle Name</label>
                      <input type="text" value={leadFields.applicant_middle_name} onChange={(e) => updateLeadField('applicant_middle_name', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Last Name</label>
                      <input type="text" value={leadFields.applicant_last_name} onChange={(e) => updateLeadField('applicant_last_name', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">DOB</label>
                      <input type="text" value={leadFields.applicant_dob} onChange={(e) => updateLeadField('applicant_dob', e.target.value)} placeholder="YYYY-MM-DD" className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Gender</label>
                      <select value={leadFields.applicant_gender} onChange={(e) => updateLeadField('applicant_gender', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="">Select...</option>
                        {['Male', 'Female', 'Other'].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Marital Status</label>
                      <select value={leadFields.applicant_marital_status} onChange={(e) => updateLeadField('applicant_marital_status', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="">Select...</option>
                        {['Single', 'Married', 'De Facto', 'Separated', 'Divorced', 'Widowed'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Address */}
                  <h3 className="text-[13px] font-medium text-muted-foreground mt-2">Address</h3>
                  <div className="grid gap-3 sm:grid-cols-1">
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Street Address</label>
                      <input type="text" value={leadFields.applicant_address} onChange={(e) => updateLeadField('applicant_address', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Suburb</label>
                      <input type="text" value={leadFields.applicant_suburb} onChange={(e) => updateLeadField('applicant_suburb', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">State</label>
                      <select value={leadFields.applicant_state} onChange={(e) => updateLeadField('applicant_state', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="">Select...</option>
                        {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Postcode</label>
                      <input type="text" value={leadFields.applicant_postcode} onChange={(e) => updateLeadField('applicant_postcode', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                  </div>

                  {/* Business (only for business loans) */}
                  {application.loan_type === 'business' && (
                    <>
                      <h3 className="text-[13px] font-medium text-muted-foreground mt-2">Business</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Business Name</label>
                          <input type="text" value={leadFields.business_name} onChange={(e) => updateLeadField('business_name', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">ABN</label>
                          <input type="text" value={leadFields.business_abn} onChange={(e) => updateLeadField('business_abn', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Registration Date</label>
                          <input type="text" value={leadFields.business_registration_date} onChange={(e) => updateLeadField('business_registration_date', e.target.value)} placeholder="YYYY-MM-DD" className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Industry ID</label>
                          <input type="number" value={leadFields.business_industry_id} onChange={(e) => updateLeadField('business_industry_id', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Monthly Sales</label>
                          <input type="number" value={leadFields.business_monthly_sales} onChange={(e) => updateLeadField('business_monthly_sales', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Loan */}
                  <h3 className="text-[13px] font-medium text-muted-foreground mt-2">Loan</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Amount</label>
                      <input type="number" value={leadFields.amount} onChange={(e) => updateLeadField('amount', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Term (months)</label>
                      <input type="number" value={leadFields.loan_term_requested} onChange={(e) => updateLeadField('loan_term_requested', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Purpose ID</label>
                      <input type="number" value={leadFields.loan_purpose_id} onChange={(e) => updateLeadField('loan_purpose_id', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                  </div>
                </div>
              )}

              {/* Broker Lend fields */}
              <div className="space-y-4 mb-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-2">Product Type ID</label>
                    <input
                      type="number"
                      value={lendProductTypeId}
                      onChange={(e) => setLendProductTypeId(e.target.value)}
                      className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="e.g. 25"
                    />
                  </div>
                  {application.loan_type === 'business' && (
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-2">Owner Type</label>
                      <select
                        value={lendOwnerType}
                        onChange={(e) => setLendOwnerType(e.target.value)}
                        className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="">Select...</option>
                        <option value="Sole Trader">Sole Trader</option>
                        <option value="Partnership">Partnership</option>
                        <option value="Company">Company</option>
                        <option value="Trust">Trust</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-2">Send Type</label>
                    <select
                      value={lendSendType}
                      onChange={(e) => setLendSendType(e.target.value)}
                      className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="Auto">Auto</option>
                      <option value="Manual">Manual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-2">Who to Contact</label>
                    <select
                      value={lendWhoToContact}
                      onChange={(e) => setLendWhoToContact(e.target.value)}
                      className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="Broker">Broker</option>
                      <option value="Client">Client</option>
                    </select>
                  </div>
                </div>
                <Button onClick={handleSaveLendFields} loading={savingLend} size="sm">Save Lend Settings</Button>
              </div>

              {/* Document type mapping */}
              {documents.length > 0 && (
                <div className="border-t border-border pt-4 mb-4">
                  <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Document Type Mapping</h3>
                  <div className="space-y-2">
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-3 rounded-xl bg-secondary/30 p-3">
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13px] font-medium text-foreground">{doc.original_filename}</p>
                        </div>
                        {doc.lend_uploaded && (
                          <svg className="h-4 w-4 text-success shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                        )}
                        <input
                          type="text"
                          value={docLendTypes[doc.id] || ''}
                          onChange={(e) => handleDocLendTypeChange(doc.id, e.target.value)}
                          className="w-40 rounded-lg bg-secondary px-2.5 py-1.5 text-[12px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Lend doc type"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sync button */}
              <Button
                onClick={handleLendSync}
                loading={syncing}
                disabled={application.lend_sync_status === 'pending' || syncing}
                variant={application.lend_sync_status === 'failed' ? 'danger' : 'primary'}
              >
                {application.lend_sync_status === 'failed' ? 'Re-sync to Lend' :
                 application.lend_sync_status === 'synced' ? 'Re-sync to Lend' :
                 application.lend_sync_status === 'pending' ? 'Syncing...' :
                 'Sync to Lend'}
              </Button>
            </GlassCard>
          )}

          {/* Internal Notes */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-4">Internal Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
              style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
              placeholder="Add internal notes about this application..."
            />
            <Button className="mt-3" onClick={handleSaveNotes}>Save Notes</Button>
          </GlassCard>

          {/* Notes & Messages */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-foreground">Notes & Messages</h2>
              <div className="flex rounded-xl bg-secondary p-0.5">
                <button
                  onClick={() => setNoteTab('internal')}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
                    noteTab === 'internal'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Internal
                </button>
                <button
                  onClick={() => setNoteTab('client')}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
                    noteTab === 'client'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Client Messages
                </button>
              </div>
            </div>

            {/* Notes list */}
            <div className="space-y-3 mb-4 max-h-80 overflow-y-auto">
              {appNotes
                .filter((n) => (noteTab === 'internal' ? n.is_internal : !n.is_internal))
                .length === 0 ? (
                <div className="rounded-xl bg-secondary/50 p-4 text-center">
                  <p className="text-[13px] text-muted-foreground">
                    {noteTab === 'internal' ? 'No internal notes yet' : 'No client messages yet'}
                  </p>
                </div>
              ) : (
                appNotes
                  .filter((n) => (noteTab === 'internal' ? n.is_internal : !n.is_internal))
                  .map((note) => (
                    <div key={note.id} className="rounded-xl bg-secondary/30 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-semibold text-foreground">{note.author_name || 'Staff'}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(note.created_at)} {new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[13px] text-foreground whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))
              )}
            </div>

            {/* Compose */}
            <div className="border-t border-border pt-3">
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                rows={3}
                className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[13px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                placeholder={noteTab === 'internal' ? 'Write an internal note...' : 'Write a message to the client...'}
              />
              <Button
                className="mt-2"
                size="sm"
                loading={sendingNote}
                disabled={!newNoteContent.trim()}
                onClick={async () => {
                  if (!id || !newNoteContent.trim()) return;
                  setSendingNote(true);
                  try {
                    const { data } = await api.post(`/applications/${id}/notes`, {
                      content: newNoteContent.trim(),
                      is_internal: noteTab === 'internal',
                    });
                    setAppNotes((prev) => [...prev, data]);
                    setNewNoteContent('');
                    toast(noteTab === 'internal' ? 'Note added' : 'Message sent to client', 'success');
                  } catch (err: any) {
                    toast(getErrorMessage(err, 'Failed to add note'), 'error');
                  } finally {
                    setSendingNote(false);
                  }
                }}
              >
                {noteTab === 'internal' ? 'Add Note' : 'Send to Client'}
              </Button>
            </div>
          </GlassCard>
        </div>

        {/* Sidebar Actions */}
        <div className="space-y-6">
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
                    variant={s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'primary'}
                    size="lg"
                    className="w-full capitalize"
                    onClick={() => handleStatusChange(s)}
                  >
                    {s}
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
                    onChange={(e) => { if (e.target.value) handleAssignBroker(e.target.value); }}
                    className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                    style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
                  >
                    <option value="">Add broker...</option>
                    {brokers
                      .filter((b) => !application.assigned_brokers.some((ab) => ab.id === b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>{b.full_name}</option>
                      ))}
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
    </div>
  );
}
