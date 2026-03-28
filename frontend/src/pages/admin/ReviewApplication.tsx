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
import { DOC_TYPE_LABELS, LEND_SYNC_BADGE, OCR_STATUS_BADGE, RECOMMENDED_DOC_TYPES, VALID_TRANSITIONS } from '../../lib/constants';
import type { ApplicationNote, BrokerGroup, DocType, Document, LendSyncStatus, LoanApplication, LoanType, NoteVisibility, User } from '../../types';

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
  const [noteTab, setNoteTab] = useState<'messages' | 'referrer'>('messages');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility[]>(['broker']);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);
  const [referrerMsgSubject, setReferrerMsgSubject] = useState('');
  const [referrerMsgContent, setReferrerMsgContent] = useState('');
  const [sendingReferrerMsg, setSendingReferrerMsg] = useState(false);
  const [retryingOcr, setRetryingOcr] = useState<string | null>(null);
  const [brokerGroups, setBrokerGroups] = useState<BrokerGroup[]>([]);
  
  const [quickNoteContent, setQuickNoteContent] = useState('');
  const [sendingQuickNote, setSendingQuickNote] = useState(false);

  // Broker edit state
  const [editLoanType, setEditLoanType] = useState<LoanType>('personal');
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingFields, setSavingFields] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEditFields, setSavingEditFields] = useState(false);
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
    business_monthly_sales: '', loan_term_years: '', loan_term_months: '', loan_purpose_id: '', amount: '',
  });
  const updateLeadField = (field: string, value: string) => setLeadFields((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!id) return;
    // Check Lend config
    api.get('/lend/config').then(({ data }) => setLendEnabled(data.enabled)).catch(() => {});
    // Fetch broker groups
    api.get('/broker-groups').then(({ data }) => setBrokerGroups(data)).catch(() => {});

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
          loan_term_years: d.loan_term_requested ? String(Math.floor(d.loan_term_requested / 12)) : '',
          loan_term_months: d.loan_term_requested ? String(d.loan_term_requested % 12) : '',
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
        // Fetch referrer info
        if (appRes.data.user_id) {
          api.get(`/users/${appRes.data.user_id}/referrer`)
            .then(({ data }) => setReferrer(data.referrer || null))
            .catch(() => {});
        }
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

  const handleSendReferrerMessage = async () => {
    if (!referrer || !referrerMsgSubject.trim() || !referrerMsgContent.trim()) return;
    setSendingReferrerMsg(true);
    try {
      await api.post('/messages', {
        recipient_id: referrer.id,
        subject: referrerMsgSubject.trim(),
        content: referrerMsgContent.trim(),
      });
      toast('Message sent to referrer', 'success');
      setReferrerMsgSubject('');
      setReferrerMsgContent('');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to send message'), 'error');
    } finally {
      setSendingReferrerMsg(false);
    }
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

  const handleAssignGroup = async (groupId: string) => {
    if (!id) return;
    try {
      const { data } = await api.post(`/applications/${id}/assign-group?group_id=${groupId}`);
      setApplication(data);
      toast('Broker group assigned', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to assign group'), 'error');
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
      toast('Application fields saved', 'success');
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to save fields'), 'error');
    } finally {
      setSavingFields(false);
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
        loan_term_requested: (leadFields.loan_term_years || leadFields.loan_term_months)
          ? (parseInt(leadFields.loan_term_years || '0') * 12) + parseInt(leadFields.loan_term_months || '0')
          : null,
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
              <div className="flex items-center gap-2">
                <Badge value={application.status} />
                {!isDraft && !editing && (
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

            {editing && !isDraft ? (
              <div className="space-y-5">
                {/* Loan basics */}
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
                    <input type="number" step="0.01" value={leadFields.amount} onChange={(e) => updateLeadField('amount', e.target.value)} className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Enter amount" />
                  </div>
                </div>

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
                <h3 className="text-[13px] font-medium text-muted-foreground">Address</h3>
                <div>
                  <label className="block text-[12px] text-muted-foreground mb-1">Street Address</label>
                  <input type="text" value={leadFields.applicant_address} onChange={(e) => updateLeadField('applicant_address', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
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
                {editLoanType === 'business' && (
                  <>
                    <h3 className="text-[13px] font-medium text-muted-foreground">Business</h3>
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

                {/* Loan terms */}
                <h3 className="text-[13px] font-medium text-muted-foreground">Loan Details</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[12px] text-muted-foreground mb-1">Term (years)</label>
                    <input type="number" min="0" max="30" value={leadFields.loan_term_years} onChange={(e) => updateLeadField('loan_term_years', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div>
                    <label className="block text-[12px] text-muted-foreground mb-1">Term (months)</label>
                    <input type="number" min="0" max="11" value={leadFields.loan_term_months} onChange={(e) => updateLeadField('loan_term_months', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div>
                    <label className="block text-[12px] text-muted-foreground mb-1">Purpose ID</label>
                    <input type="number" value={leadFields.loan_purpose_id} onChange={(e) => updateLeadField('loan_purpose_id', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
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
                      step="0.01"
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
                  variant={allDocsUploaded ? 'success' : 'primary'}
                  size="lg"
                  className="w-full"
                  onClick={handleBrokerSubmit}
                  disabled={submittingOnBehalf}
                  loading={submittingOnBehalf}
                >
                  Submit on Behalf of Client
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
                </div>
              )}
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
                      <input type="number" step="0.01" value={leadFields.amount} onChange={(e) => updateLeadField('amount', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Term (years)</label>
                      <input type="number" min="0" max="30" value={leadFields.loan_term_years} onChange={(e) => updateLeadField('loan_term_years', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-[12px] text-muted-foreground mb-1">Term (months)</label>
                      <input type="number" min="0" max="11" value={leadFields.loan_term_months} onChange={(e) => updateLeadField('loan_term_months', e.target.value)} className="w-full rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30" />
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

          {/* Notes & Messages */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4 border-b border-border pb-4">
              <h2 className="text-[16px] font-semibold text-foreground">Notes & Messages</h2>
              {referrer && (
                <div className="flex rounded-xl bg-secondary/80 p-1">
                  <button
                    onClick={() => setNoteTab('messages')}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-300 ${
                      noteTab === 'messages'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                    }`}
                  >
                    Messages
                  </button>
                  <button
                    onClick={() => {
                      setNoteTab('referrer');
                      if (!referrerMsgSubject) setReferrerMsgSubject(`Re: Referral - ${client?.full_name || 'Client'}`);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-300 ${
                      noteTab === 'referrer'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                    }`}
                  >
                    DM Referrer
                  </button>
                </div>
              )}
            </div>

            {noteTab === 'referrer' && referrer ? (
              /* Referrer direct message compose */
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center gap-3 rounded-2xl bg-secondary/30 p-4 border border-border/50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-4/15 text-chart-4 shadow-inner">
                    <span className="text-[13px] font-bold">{referrer.full_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{referrer.full_name}</p>
                    <p className="text-[12px] text-muted-foreground">{referrer.email}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={referrerMsgSubject}
                    onChange={(e) => setReferrerMsgSubject(e.target.value)}
                    placeholder="Subject..."
                    className="w-full rounded-2xl bg-secondary/50 px-4 py-3 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                  />
                  <div className="relative">
                    <textarea
                      value={referrerMsgContent}
                      onChange={(e) => setReferrerMsgContent(e.target.value)}
                      rows={4}
                      placeholder="Write a message to the referrer..."
                      className="w-full rounded-2xl bg-secondary/50 px-4 py-3 pb-16 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground resize-none"
                    />
                    <div className="absolute bottom-3 right-3">
                      <Button
                        size="sm"
                        onClick={handleSendReferrerMessage}
                        loading={sendingReferrerMsg}
                        disabled={!referrerMsgSubject.trim() || !referrerMsgContent.trim()}
                        className="rounded-xl px-4"
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-[500px] animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* All notes list */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
                  {appNotes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                      <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                        <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                      </div>
                      <p className="text-[13px] font-medium text-muted-foreground">No messages yet</p>
                    </div>
                  ) : (
                    appNotes.map((note) => {
                      const isInternal = note.visibility.length === 1 && note.visibility[0] === 'broker';
                      return (
                        <div key={note.id} className="flex flex-col gap-1.5 group/note">
                          <div className="flex items-baseline justify-between px-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-foreground">{note.author_name || 'Staff'}</span>
                              {note.author_role && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground capitalize uppercase tracking-wider">
                                  {note.author_role}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  if (!id) return;
                                  try {
                                    await api.delete(`/applications/${id}/notes/${note.id}`);
                                    setAppNotes((prev) => prev.filter((n) => n.id !== note.id));
                                    toast('Message deleted', 'success');
                                  } catch (err: any) {
                                    toast(getErrorMessage(err, 'Failed to delete'), 'error');
                                  }
                                }}
                                className="opacity-0 group-hover/note:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                title="Delete message"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                              </button>
                              <span className="text-[11px] font-medium text-muted-foreground">
                                {formatDate(note.created_at)} &middot; {new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          <div className={`rounded-2xl p-3.5 text-[14px] leading-relaxed relative ${isInternal ? 'bg-secondary/40 text-foreground border border-transparent' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                            <p className="whitespace-pre-wrap">{note.content}</p>
                            
                            {/* Visibility Indicators */}
                            <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border/30">
                              <svg className="h-3.5 w-3.5 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                              {isInternal ? (
                                <span className="text-[11px] font-medium opacity-60">Internal (Brokers only)</span>
                              ) : (
                                <div className="flex gap-1.5">
                                  {note.visibility.filter((v) => v !== 'broker').map((v) => (
                                    <span
                                      key={v}
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                                        v === 'client' ? 'bg-chart-2/20 text-chart-2' :
                                        'bg-chart-4/20 text-chart-4'
                                      }`}
                                    >
                                      {v}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Sleek Compose Area */}
                <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-primary/50 focus-within:bg-secondary/60 transition-all duration-300 flex flex-col pt-1">
                  <textarea
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    rows={2}
                    className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none min-h-[60px]"
                    placeholder="Write a message..."
                  />
                  
                  <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-border/30 mt-1">
                    <div className="flex items-center gap-1 bg-background/50 rounded-xl p-1 backdrop-blur-sm border border-border/50">
                      {([
                        { key: 'broker' as NoteVisibility, label: 'Internal', locked: true },
                        { key: 'client' as NoteVisibility, label: 'Client', locked: false },
                        { key: 'referrer' as NoteVisibility, label: 'Referrer', locked: false },
                      ]).map(({ key, label, locked }) => {
                        const active = noteVisibility.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={locked}
                            onClick={() => {
                              if (locked) return;
                              setNoteVisibility((prev) =>
                                active ? prev.filter((v) => v !== key) : [...prev, key]
                              );
                            }}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all duration-200 ${
                              active
                                ? locked
                                  ? 'bg-muted/80 text-muted-foreground/80 cursor-default'
                                  : key === 'client'
                                    ? 'bg-chart-2/20 text-chart-2 shadow-sm'
                                    : 'bg-chart-4/20 text-chart-4 shadow-sm'
                                : 'text-muted-foreground/60 hover:text-foreground hover:bg-secondary'
                            }`}
                          >
                            {active ? (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                            ) : (
                              <div className="h-3 w-3 rounded-full border border-current" />
                            )}
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <Button
                      size="sm"
                      className="rounded-xl px-4 h-9"
                      loading={sendingNote}
                      disabled={!newNoteContent.trim()}
                      onClick={async () => {
                        if (!id || !newNoteContent.trim()) return;
                        setSendingNote(true);
                        try {
                          const { data } = await api.post(`/applications/${id}/notes`, {
                            content: newNoteContent.trim(),
                            visibility: noteVisibility,
                          });
                          setAppNotes((prev) => [...prev, data]);
                          setNewNoteContent('');
                          const targets = noteVisibility.filter((v) => v !== 'broker');
                          toast(targets.length > 0 ? `Message sent (visible to ${targets.join(', ')})` : 'Internal note added', 'success');
                        } catch (err: any) {
                          toast(getErrorMessage(err, 'Failed to send message'), 'error');
                        } finally {
                          setSendingNote(false);
                        }
                      }}
                    >
                      <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                      {noteVisibility.length === 1 && noteVisibility[0] === 'broker' ? 'Note' : 'Send'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </GlassCard>
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

          {/* Quick Internal Notes */}
          <GlassCard>
            <h2 className="text-[15px] font-semibold text-foreground mb-4">Quick Internal Notes</h2>
            <div className="space-y-3 mb-4 max-h-60 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
              {appNotes.filter(n => n.visibility.length === 1 && n.visibility[0] === 'broker').length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-4">No internal notes</p>
              ) : (
                appNotes
                  .filter(n => n.visibility.length === 1 && n.visibility[0] === 'broker')
                  .map(note => (
                    <div key={note.id} className="rounded-xl bg-secondary/40 p-3 text-[13px] text-foreground border border-transparent">
                      <div className="flex justify-between items-start mb-1.5">
                        <span className="font-semibold text-[12px]">{note.author_name || 'Staff'}</span>
                        <span className="text-[10px] font-medium text-muted-foreground">{formatDate(note.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed opacity-90">{note.content}</p>
                    </div>
                  ))
              )}
            </div>
            <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-border/30">
              <textarea
                value={quickNoteContent}
                onChange={(e) => setQuickNoteContent(e.target.value)}
                rows={2}
                placeholder="Add internal note..."
                className="w-full rounded-xl bg-secondary/50 px-3 py-2.5 text-[13px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder-muted-foreground"
              />
              <Button
                size="sm"
                className="w-full h-8 rounded-lg"
                loading={sendingQuickNote}
                disabled={!quickNoteContent.trim()}
                onClick={async () => {
                  if (!id || !quickNoteContent.trim()) return;
                  setSendingQuickNote(true);
                  try {
                    const { data } = await api.post(`/applications/${id}/notes`, {
                      content: quickNoteContent.trim(),
                      visibility: ['broker'],
                    });
                    setAppNotes((prev) => [...prev, data]);
                    setQuickNoteContent('');
                    toast('Internal note added', 'success');
                  } catch (err: any) {
                    toast(getErrorMessage(err, 'Failed to add note'), 'error');
                  } finally {
                    setSendingQuickNote(false);
                  }
                }}
              >
                Add Note
              </Button>
            </div>
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
                    className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
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
    </div>
  );
}
