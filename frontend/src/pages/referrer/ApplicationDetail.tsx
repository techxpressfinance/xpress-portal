import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../api/client';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { useFileDownload } from '../../hooks/useFileDownload';
import { GlassCard, Badge, Button, ConfirmDialog } from '../../components/ui';
import { getErrorMessage, formatDate, formatTime, getInitials } from '../../lib/utils';
import { DOC_TYPE_LABELS, OCR_STATUS_BADGE, RECOMMENDED_DOC_TYPES, LOAN_TYPE_LABELS } from '../../lib/constants';
import type { ApplicationNote, ClientMessage, DocType, Document, DocumentRequest, LoanApplication, LoanType, User } from '../../types';

export default function ReferrerApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { downloadFile } = useFileDownload();
  const fileInput = useRef<HTMLInputElement>(null);

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [client, setClient] = useState<User | null>(null);
  const [appNotes, setAppNotes] = useState<ApplicationNote[]>([]);
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'documents' | 'messages'>('overview');

  // Document upload
  const [docType, setDocType] = useState<DocType>('id_proof');
  const [fileLabel, setFileLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [retryingOcr, setRetryingOcr] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);

  // Submit on behalf
  const [confirmBrokerSubmit, setConfirmBrokerSubmit] = useState(false);
  const [submittingOnBehalf, setSubmittingOnBehalf] = useState(false);

  // Notes
  const [newNoteContent, setNewNoteContent] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'referrer' | 'personal'>('referrer');
  const [sendingNote, setSendingNote] = useState(false);

  // Client messages
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [newClientMsgContent, setNewClientMsgContent] = useState('');
  const [sendingClientMsg, setSendingClientMsg] = useState(false);
  const [msgTab, setMsgTab] = useState<'client_chat' | 'notes'>('client_chat');

  // Doc requests
  const [showDocRequestForm, setShowDocRequestForm] = useState(false);
  const [docRequestDescription, setDocRequestDescription] = useState('');
  const [submittingDocRequest, setSubmittingDocRequest] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
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
  };
  const { register: regEdit, reset: resetEdit, handleSubmit: handleEditSubmit, watch: watchEdit, formState: { errors: editErrors } } = useForm({ defaultValues: EDIT_DEFAULTS });

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/applications/${id}`),
      api.get(`/documents/application/${id}`),
      api.get(`/applications/${id}/notes`),
      api.get(`/documents/requests/${id}`),
    ])
      .then(([appRes, docRes, notesRes, reqRes]) => {
        const d = appRes.data;
        setApplication(d);
        setDocuments(docRes.data);
        setAppNotes(notesRes.data);
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
        });
        if (d.user_id && d.user_id !== currentUser?.id) {
          api.get(`/users/${d.user_id}`).then(({ data }) => setClient(data)).catch(() => { });
          api.get(`/clients/${d.user_id}/messages`).then(({ data }) => setClientMessages(data)).catch(() => { });
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
  const uploadedDocTypes = new Set(documents.map((d) => d.doc_type));
  const allDocsUploaded = RECOMMENDED_DOC_TYPES.every((t) => uploadedDocTypes.has(t));
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link to="/referrer/applications" className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors">
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
                          <label className="block text-[12px] text-muted-foreground mb-1">DOB</label>
                          <input type="text" placeholder="YYYY-MM-DD" className="led-input" {...regEdit('applicant_dob')} />
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

                      {(watchEdit('loan_type') === 'business' || watchEdit('business_name') || watchEdit('business_abn')) && (
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
                        <dd className="mt-1 text-[28px] font-semibold text-foreground tracking-tight">${Number(application.amount).toLocaleString()}</dd>
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

            {/* ── FULL DETAILS ── */}
            {activeTab === 'details' && (
              <div className="space-y-6">
                {/* Contact */}
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

                {/* Identification */}
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Identification</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">ID Expiry Date</label>
                      <input type="text" placeholder="YYYY-MM-DD" className="led-input" {...regEdit('id_expiry_date')} />
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

                {/* Living Situation */}
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

                {/* Employment & Income */}
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

                {/* Business Details */}
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

                {/* Emergency Contact */}
                <GlassCard>
                  <h2 className="text-[15px] font-semibold text-foreground mb-5">Emergency Contact</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Name</label>
                      <input type="text" className="led-input" {...regEdit('emergency_contact_name')} />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-muted-foreground mb-1">Relationship</label>
                      <input type="text" className="led-input" placeholder="e.g. Spouse, Parent" {...regEdit('emergency_contact_relationship')} />
                    </div>
                  </div>
                </GlassCard>

                {/* Declarations */}
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

                <div className="flex items-center gap-3 pb-2">
                  <Button onClick={handleEditSubmit(handleSaveDetails)} loading={savingDetails}>Save Details</Button>
                </div>
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
                      <p className="text-[13px] font-medium text-foreground mb-2">Specify which documents you need from the client</p>
                      <textarea
                        value={docRequestDescription}
                        onChange={(e) => setDocRequestDescription(e.target.value)}
                        placeholder="e.g. Last 3 months of bank statements, most recent payslip..."
                        rows={3}
                        className="w-full rounded-xl bg-background px-3.5 py-2.5 text-[13px] text-foreground border border-border/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                      />
                      <div className="flex items-center gap-2 mt-3">
                        <Button size="sm" onClick={handleSubmitDocRequest} disabled={!docRequestDescription.trim() || submittingDocRequest} loading={submittingDocRequest}>Send Request</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowDocRequestForm(false); setDocRequestDescription(''); }}>Cancel</Button>
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
                {/* Tab toggle */}
                <div className="flex gap-1 mb-5 border-b border-border pb-4">
                  {([
                    { key: 'client_chat' as const, label: 'Client Chat' },
                    { key: 'notes' as const, label: 'Notes' },
                  ]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setMsgTab(key)}
                      className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all duration-200 ${msgTab === key
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Client Chat ── */}
                {msgTab === 'client_chat' && (
                  <div className="flex flex-col h-[460px]">
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
                                <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || 'Client')}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {formatTime(msg.created_at)}
                                </span>
                              </div>
                              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn
                                ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                : 'bg-secondary text-foreground rounded-tl-sm'
                                }`}>
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
                            if (client?.id && newClientMsgContent.trim()) {
                              setSendingClientMsg(true);
                              api.post(`/clients/${client.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: client.id })
                                .then(({ data }) => { setClientMessages((prev) => [...prev, data]); setNewClientMsgContent(''); toast('Message sent', 'success'); })
                                .catch((err: unknown) => toast(getErrorMessage(err, 'Failed to send'), 'error'))
                                .finally(() => setSendingClientMsg(false));
                            }
                          }
                        }}
                        rows={2}
                        className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none"
                        placeholder={`Message ${client?.full_name || 'client'}…`}
                      />
                      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        <span className="text-[11px] text-muted-foreground">⌘↵ to send</span>
                        <Button
                          size="sm"
                          className="rounded-xl h-8 px-3.5"
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
                          <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Notes ── */}
                {msgTab === 'notes' && (
                  <div className="flex flex-col h-[460px]">
                    <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 mb-3">
                      {appNotes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2 opacity-60">
                          <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                          <p className="text-[13px] text-muted-foreground">No notes yet</p>
                        </div>
                      ) : (
                        appNotes.map((note) => {
                          const isPersonal = note.visibility.includes('personal');
                          return (
                          <div key={note.id} className="flex flex-col gap-1">
                            <div className="flex items-center justify-between px-1">
                              <span className="text-[12px] font-semibold text-foreground">{note.author_name || 'Staff'}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatTime(note.created_at)}
                              </span>
                            </div>
                            <div className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground ${isPersonal ? 'bg-amber-500/8 border border-amber-500/20' : 'bg-secondary/60'}`}>
                              <p className="whitespace-pre-wrap">{note.content}</p>
                              {isPersonal && (
                                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
                                  <svg className="h-3 w-3 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                                  <span className="text-[11px] font-medium opacity-60">Only you</span>
                                </div>
                              )}
                            </div>
                          </div>
                          );
                        })
                      )}
                    </div>

                    {/* Compose note */}
                    <div className="rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 transition-colors flex flex-col">
                      <textarea
                        value={newNoteContent}
                        onChange={(e) => setNewNoteContent(e.target.value)}
                        rows={2}
                        className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none"
                        placeholder="Add a note…"
                      />
                      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        <button
                          type="button"
                          onClick={() => setNoteVisibility((v) => v === 'referrer' ? 'personal' : 'referrer')}
                          className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-lg transition-colors ${noteVisibility === 'personal' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                          title={noteVisibility === 'personal' ? 'Only visible to you — click to share' : 'Visible to team — click to make private'}
                        >
                          {noteVisibility === 'personal' ? (
                            <>
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                              Only me
                            </>
                          ) : (
                            <>
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
                              Team
                            </>
                          )}
                        </button>
                        <Button
                          size="sm"
                          className="rounded-xl h-8 px-3.5"
                          loading={sendingNote}
                          disabled={!newNoteContent.trim()}
                          onClick={async () => {
                            if (!id || !newNoteContent.trim()) return;
                            setSendingNote(true);
                            try {
                              const { data } = await api.post(`/applications/${id}/notes`, { content: newNoteContent.trim(), visibility: [noteVisibility] });
                              setAppNotes((prev) => [...prev, data]);
                              setNewNoteContent('');
                              toast('Note saved', 'success');
                            } catch (err: unknown) {
                              toast(getErrorMessage(err, 'Failed to save'), 'error');
                            } finally {
                              setSendingNote(false);
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
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
