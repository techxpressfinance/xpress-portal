import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import AnalysisPanel from '../../components/AnalysisPanel';
import ApplicationCalculators from '../../components/ApplicationCalculators';
import DirectorsSection from '../../components/DirectorsSection';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import QuoteSheetComparison from '../../components/QuoteSheetComparison';
import QuoteSheetEditor from '../../components/QuoteSheetEditor';
import StatusTimeline from '../../components/StatusTimeline';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useBrokerAssignment } from '../../hooks/useBrokerAssignment';
import { useFileDownload } from '../../hooks/useFileDownload';
import { GlassCard, Badge, Button, ConfirmDialog, Breadcrumbs, DatePicker, InviteLinkBox } from '../../components/ui';
import { getErrorMessage, formatDate, formatDateTime, formatTime, getInitials } from '../../lib/utils';
import { APPLICATION_SECTIONS, DOC_TYPE_LABELS, OCR_STATUS_BADGE, QUOTE_SHEET_STATUS_BADGE, RECOMMENDED_DOC_TYPES, STATUS_LABEL, VALID_TRANSITIONS } from '../../lib/constants';
import { downloadQuoteSheetPdf } from '../../lib/pdfExport';
import type { ActivityLog, ApplicationNote, BrokerGroup, ClientAlert, ClientMessage, DocType, Document, DocumentRequest, Lender, LenderSubmission, LenderSubmissionStatus, LoanApplication, LoanType, QuoteSheet, User } from '../../types';
import { ACTION_ICON_CONFIG, ACTION_LABELS } from '../../lib/constants';
import { SUBMISSION_STATUS_BADGE } from '../../lib/constants';

export default function ReviewApplication() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { assignBroker, unassignBroker } = useBrokerAssignment();
  const { downloadFile } = useFileDownload();

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [client, setClient] = useState<User | null>(null);
  const [referrer, setReferrer] = useState<{ id: string; full_name: string; email: string; phone: string | null; organization_name?: string | null } | null>(null);
  const [brokers, setBrokers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [appNotes, setAppNotes] = useState<ApplicationNote[]>([]);
  const [msgTab, setMsgTab] = useState<'referrer_messages' | 'client_messages' | 'deal_notes' | 'alerts'>('referrer_messages');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'broker' | 'personal'>('broker');
  const [sendingNote, setSendingNote] = useState(false);
  const [pinningMsgId, setPinningMsgId] = useState<string | null>(null);
  const [pinnedMsgIds, setPinnedMsgIds] = useState<Set<string>>(new Set());
  // Maps a pinned deal note's id back to its source message id, so deleting the
  // note un-checks the message it came from.
  const [noteSourceMsg, setNoteSourceMsg] = useState<Record<string, string>>({});
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [newClientMsgContent, setNewClientMsgContent] = useState('');
  const [sendingClientMsg, setSendingClientMsg] = useState(false);
  const [referrerMessages, setReferrerMessages] = useState<ClientMessage[]>([]);
  const [newRefMsgContent, setNewRefMsgContent] = useState('');
  const [sendingRefMsg, setSendingRefMsg] = useState(false);
  const [alerts, setAlerts] = useState<ClientAlert[]>([]);
  const [newAlertContent, setNewAlertContent] = useState('');
  const [newAlertHighPriority, setNewAlertHighPriority] = useState(false);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; ocrStatus: Document['ocr_status'] } | null>(null);
  const [retryingOcr, setRetryingOcr] = useState<string | null>(null);
  const [brokerGroups, setBrokerGroups] = useState<BrokerGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'submissions' | 'quotes' | 'messages' | 'activity'>('overview');
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingAppPdf, setDownloadingAppPdf] = useState(false);
  const [pdfRenderApp, setPdfRenderApp] = useState(false);

  // Document requests state
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [showDocRequestForm, setShowDocRequestForm] = useState(false);
  const [docRequestItems, setDocRequestItems] = useState<string[]>(['']);
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
      await downloadQuoteSheetPdf(`quote-sheet-pdf-${sheet.id}`, `quote-sheet-v${sheet.version}-${suffix}.pdf`, [10, 0, 10, 0]);
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
  const [editing, setEditing] = useState(false);
  const [savingEditFields, setSavingEditFields] = useState(false);
  const [submittingOnBehalf, setSubmittingOnBehalf] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [reasonModalStatus, setReasonModalStatus] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [savingWithReason, setSavingWithReason] = useState(false);
  const [confirmBrokerSubmit, setConfirmBrokerSubmit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingApp, setDeletingApp] = useState(false);
  const [togglingLock, setTogglingLock] = useState(false);
  const [invitingClient, setInvitingClient] = useState(false);
  const [clientInviteLink, setClientInviteLink] = useState<string | null>(null);
  const [showSections, setShowSections] = useState(false);
  const [savingSections, setSavingSections] = useState(false);
  const [sectionDraft, setSectionDraft] = useState<string[]>([]);
  const [docType, setDocType] = useState<DocType>('id_proof');
  const [uploading, setUploading] = useState(false);
  const [fileLabel, setFileLabel] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const EDIT_DEFAULTS = {
    loan_type: 'personal' as LoanType, notes: '', amount: '',
    applicant_title: '', applicant_first_name: '', applicant_last_name: '', applicant_middle_name: '',
    applicant_dob: '', applicant_gender: '', applicant_marital_status: '',
    applicant_email: '', applicant_mobile: '', preferred_contact_method: '',
    applicant_address: '', applicant_suburb: '', applicant_state: '', applicant_postcode: '',
    id_type: 'license', id_number: '', id_issuing_state_country: '',
    id_expiry_date: '', applicant_residency_status: '',
    residential_status: '', time_at_address: '', applicant_num_dependants: '',
    has_partner: '' as '' | 'true' | 'false', partner_working: '' as '' | 'true' | 'false',
    employment_category: '', employer_name: '', employer_industry: '', job_title: '', income_frequency: '', gross_income: '',
    business_name: '', business_abn: '', business_registration_date: '', business_industry_id: '',
    business_monthly_sales: '', trading_name: '', business_structure: '',
    gst_registered: '' as '' | 'true' | 'false', num_directors: '', time_trading: '',
    loan_term_years: '', loan_term_months: '', loan_purpose_id: '',
    previously_declined: '' as '' | 'true' | 'false', change_of_circumstances: '' as '' | 'true' | 'false',
    signature_name: '',
    emergency_contact_name: '', emergency_contact_relationship: '', emergency_contact_phone: '',
  };
  const { register: regEdit, reset: resetEdit, handleSubmit: handleEditSubmit, watch: watchEdit, setValue: setValueEdit, formState: { errors: editErrors } } = useForm({ defaultValues: EDIT_DEFAULTS });

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
        const d = appRes.data;
        let idEntry: Record<string, string> | null = null;
        try {
          const extra = d.lend_extra_data ? JSON.parse(d.lend_extra_data) : {};
          idEntry = Array.isArray(extra.identification) ? extra.identification[0] : null;
        } catch { /* ignore malformed extra data */ }
        resetEdit({
          loan_type: d.loan_type || 'personal', notes: d.notes || '', amount: d.amount ? String(d.amount) : '',
          id_type: idEntry?.type === 'Passport' ? 'passport' : 'license',
          id_number: idEntry?.number || '',
          id_issuing_state_country: idEntry?.state || idEntry?.country || '',
          applicant_title: d.applicant_title || '', applicant_first_name: d.applicant_first_name || '',
          applicant_last_name: d.applicant_last_name || '', applicant_middle_name: d.applicant_middle_name || '',
          applicant_dob: d.applicant_dob || '', applicant_gender: d.applicant_gender || '',
          applicant_marital_status: d.applicant_marital_status || '',
          applicant_email: d.applicant_email || '', applicant_mobile: d.applicant_mobile || '',
          preferred_contact_method: d.preferred_contact_method || '',
          applicant_address: d.applicant_address || '', applicant_suburb: d.applicant_suburb || '',
          applicant_state: d.applicant_state || '', applicant_postcode: d.applicant_postcode || '',
          id_expiry_date: idEntry?.expiry_date || d.id_expiry_date || '', applicant_residency_status: d.applicant_residency_status || '',
          residential_status: d.residential_status || '', time_at_address: d.time_at_address || '',
          applicant_num_dependants: d.applicant_num_dependants != null ? String(d.applicant_num_dependants) : '',
          has_partner: d.has_partner === null || d.has_partner === undefined ? '' : d.has_partner ? 'true' : 'false',
          partner_working: d.partner_working === null || d.partner_working === undefined ? '' : d.partner_working ? 'true' : 'false',
          employment_category: d.employment_category || '', employer_name: d.employer_name || '',
          employer_industry: d.employer_industry || '', job_title: d.job_title || '',
          income_frequency: d.income_frequency || '', gross_income: d.gross_income ? String(d.gross_income) : '',
          business_name: d.business_name || '', business_abn: d.business_abn || '',
          business_registration_date: d.business_registration_date || '',
          business_industry_id: d.business_industry_id ? String(d.business_industry_id) : '',
          business_monthly_sales: d.business_monthly_sales ? String(d.business_monthly_sales) : '',
          trading_name: d.trading_name || '', business_structure: d.business_structure || '',
          gst_registered: d.gst_registered === null || d.gst_registered === undefined ? '' : d.gst_registered ? 'true' : 'false',
          num_directors: d.num_directors != null ? String(d.num_directors) : '', time_trading: d.time_trading || '',
          loan_term_years: d.loan_term_requested ? String(Math.floor(d.loan_term_requested / 12)) : '',
          loan_term_months: d.loan_term_requested ? String(d.loan_term_requested % 12) : '',
          loan_purpose_id: d.loan_purpose_id ? String(d.loan_purpose_id) : '',
          previously_declined: d.previously_declined === null || d.previously_declined === undefined ? '' : d.previously_declined ? 'true' : 'false',
          change_of_circumstances: d.change_of_circumstances === null || d.change_of_circumstances === undefined ? '' : d.change_of_circumstances ? 'true' : 'false',
          signature_name: d.signature_name || '',
          emergency_contact_name: d.emergency_contact_name || '',
          emergency_contact_relationship: d.emergency_contact_relationship || '',
          emergency_contact_phone: d.emergency_contact_phone || '',
        });

        const clientUser = usersRes.data.find((u: User) => u.id === appRes.data.user_id);
        setBrokers(usersRes.data.filter((u: User) => u.role === 'broker'));

        if (clientUser?.role === 'referrer') {
          // Direct referrer lead — user_id IS the referrer, client has no account
          setClient(null);
          setReferrer({ id: clientUser.id, full_name: clientUser.full_name, email: clientUser.email, phone: clientUser.phone, organization_name: appRes.data.referrer?.organization_name ?? null });
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
    if (client?.id) {
      api.get(`/clients/${client.id}/messages`, { params: { application_id: id } })
        .then(({ data }) => setClientMessages(data))
        .catch(() => { });
      api.get(`/clients/${client.id}/alerts`)
        .then(({ data }) => setAlerts(data))
        .catch(() => { });
    }
    if (referrer?.id) {
      api.get(`/clients/${referrer.id}/messages`, { params: { application_id: id } })
        .then(({ data }) => setReferrerMessages(data))
        .catch(() => { });
    }
  }, [client?.id, referrer?.id]);

  const refetchApplication = async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/applications/${id}`);
      setApplication(data);
    } catch { /* ignore */ }
  };

  const handleStatusChange = (newStatus: string) => {
    if (!id) return;
    if (newStatus === 'rejected' || newStatus === 'not_proceeding') {
      setReasonText('');
      setReasonModalStatus(newStatus);
    } else {
      setPendingStatus(newStatus);
    }
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

  const handlePinMessageToDealNotes = async (msg: ClientMessage, who: string) => {
    if (!id) return;
    setPinningMsgId(msg.id);
    try {
      const { data } = await api.post(`/applications/${id}/notes`, {
        content: `${msg.content}\n\n— from ${who}'s message`,
        visibility: ['broker'],
      });
      setAppNotes((prev) => [...prev, data]);
      setPinnedMsgIds((prev) => new Set(prev).add(msg.id));
      setNoteSourceMsg((prev) => ({ ...prev, [data.id]: msg.id }));
      toast('Added to deal notes', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to add to deal notes'), 'error');
    } finally {
      setPinningMsgId(null);
    }
  };

  const confirmStatusWithReason = async () => {
    if (!id || !reasonModalStatus || !reasonText.trim()) return;
    setSavingWithReason(true);
    try {
      const { data } = await api.patch(`/applications/${id}/status?status=${reasonModalStatus}`);
      setApplication(data);
      const label = reasonModalStatus === 'rejected' ? 'Rejected' : 'Not Proceeding';
      const { data: note } = await api.post(`/applications/${id}/notes`, {
        content: `**${label}** — ${reasonText.trim()}`,
        visibility: ['broker'],
      });
      setAppNotes(prev => [...prev, note]);
      toast(`Status changed to ${reasonModalStatus}`, 'success');
      setReasonModalStatus(null);
      setReasonText('');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to change status'), 'error');
    } finally {
      setSavingWithReason(false);
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


  const handleSaveEditFields = async (fields: typeof EDIT_DEFAULTS) => {
    if (!id) return;
    setSavingEditFields(true);
    try {
      const payload: Record<string, unknown> = {
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
        applicant_email: fields.applicant_email || null,
        applicant_mobile: fields.applicant_mobile || null,
        preferred_contact_method: fields.preferred_contact_method || null,
        applicant_address: fields.applicant_address || null,
        applicant_suburb: fields.applicant_suburb || null,
        applicant_state: fields.applicant_state || null,
        applicant_postcode: fields.applicant_postcode || null,
        id_expiry_date: fields.id_expiry_date || null,
        applicant_residency_status: fields.applicant_residency_status || null,
        residential_status: fields.residential_status || null,
        time_at_address: fields.time_at_address || null,
        applicant_num_dependants: fields.applicant_num_dependants !== '' ? parseInt(fields.applicant_num_dependants) : null,
        has_partner: fields.has_partner === '' ? null : fields.has_partner === 'true',
        partner_working: fields.partner_working === '' ? null : fields.partner_working === 'true',
        employment_category: fields.employment_category || null,
        employer_name: fields.employer_name || null,
        employer_industry: fields.employer_industry || null,
        job_title: fields.job_title || null,
        income_frequency: fields.income_frequency || null,
        gross_income: fields.gross_income ? parseFloat(fields.gross_income) : null,
        business_name: fields.business_name || null,
        business_abn: fields.business_abn || null,
        business_registration_date: fields.business_registration_date || null,
        business_industry_id: fields.business_industry_id ? parseInt(fields.business_industry_id) : null,
        business_monthly_sales: fields.business_monthly_sales ? parseFloat(fields.business_monthly_sales) : null,
        trading_name: fields.trading_name || null,
        business_structure: fields.business_structure || null,
        gst_registered: fields.gst_registered === '' ? null : fields.gst_registered === 'true',
        num_directors: fields.num_directors !== '' ? parseInt(fields.num_directors) : null,
        time_trading: fields.time_trading || null,
        loan_term_requested: (fields.loan_term_years || fields.loan_term_months)
          ? (parseInt(fields.loan_term_years || '0') * 12) + parseInt(fields.loan_term_months || '0')
          : null,
        loan_purpose_id: fields.loan_purpose_id ? parseInt(fields.loan_purpose_id) : null,
        previously_declined: fields.previously_declined === '' ? null : fields.previously_declined === 'true',
        change_of_circumstances: fields.change_of_circumstances === '' ? null : fields.change_of_circumstances === 'true',
        signature_name: fields.signature_name || null,
        emergency_contact_name: fields.emergency_contact_name || null,
        emergency_contact_relationship: fields.emergency_contact_relationship || null,
        emergency_contact_phone: fields.emergency_contact_phone || null,
      };

      // ID details live in lend_extra_data.identification — merge them in while
      // preserving every other key already stored there.
      let extra: Record<string, unknown> = {};
      try { extra = application?.lend_extra_data ? JSON.parse(application.lend_extra_data) : {}; } catch { extra = {}; }
      if (fields.id_number) {
        extra.identification = [{
          type: fields.id_type === 'license' ? 'Drivers Licence' : 'Passport',
          number: fields.id_number,
          [fields.id_type === 'license' ? 'state' : 'country']: fields.id_issuing_state_country,
          expiry_date: fields.id_expiry_date,
        }];
      } else {
        delete extra.identification;
      }
      payload.lend_extra_data = JSON.stringify(extra);

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

  const handleDeleteApplication = async () => {
    if (!id) return;
    setDeletingApp(true);
    try {
      await api.delete(`/applications/${id}`);
      toast('Application deleted', 'success');
      navigate('/admin/applications');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to delete application'), 'error');
      setConfirmDelete(false);
    } finally {
      setDeletingApp(false);
    }
  };

  const handleToggleLock = async () => {
    if (!id || !application) return;
    setTogglingLock(true);
    const newLocked = !application.is_locked;
    try {
      const { data } = await api.patch(`/applications/${id}/lock?locked=${newLocked}`);
      setApplication(data);
      toast(newLocked ? 'Application locked — client cannot edit it' : 'Application unlocked — client can edit again', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update lock'), 'error');
    } finally {
      setTogglingLock(false);
    }
  };

  const parseClientSections = (raw?: string | null): string[] | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : null;
    } catch {
      return null;
    }
  };

  const openSectionsModal = () => {
    if (!application) return;
    const current = parseClientSections(application.client_sections);
    // null (not yet configured) means all sections are visible by default.
    setSectionDraft(current ?? APPLICATION_SECTIONS.map(s => s.key));
    setShowSections(true);
  };

  const toggleSectionDraft = (key: string) => {
    setSectionDraft(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleSaveSections = async () => {
    if (!id) return;
    setSavingSections(true);
    try {
      const { data } = await api.patch(`/applications/${id}/client-sections`, { sections: sectionDraft });
      setApplication(data);
      toast('Client sections updated', 'success');
      setShowSections(false);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to update sections'), 'error');
    } finally {
      setSavingSections(false);
    }
  };

  const handleInviteClient = async () => {
    if (!id) return;
    setInvitingClient(true);
    try {
      const { data: inviteData } = await api.post('/invitations/complete-application', { application_id: id });
      const isResend = !!application?.client_invite_sent_at;
      toast(isResend ? 'Invite resent to client' : 'Invite sent to client', 'success');
      setClientInviteLink(inviteData.invite_url || null);
      // Refresh application so client_invite_sent_at and client_account_pending update
      const { data } = await api.get(`/applications/${id}`);
      setApplication(data);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send invite'), 'error');
    } finally {
      setInvitingClient(false);
    }
  };

  const handleUploadFile = async (file: File) => {
    if (!id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast('File size exceeds 10MB limit', 'error');
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

  // The applicant's name as entered on the form; falls back to the account owner
  // (user_name / client) so the name is consistent with the applications list and
  // never blank on drafts that haven't been filled in yet.
  const applicantFormName = [application.applicant_title, application.applicant_first_name, application.applicant_middle_name, application.applicant_last_name].filter(Boolean).join(' ');
  const displayName = applicantFormName || application.user_name || client?.full_name || '—';

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumbs items={[
        { label: 'Applications', href: '/admin/applications' },
        { label: application ? `APP-${application.id.replace(/-/g, '').slice(-6).toUpperCase()}` : 'Review' },
      ]} />
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleDownloadAppPdf} loading={downloadingAppPdf} disabled={downloadingAppPdf}>
            <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Download PDF
          </Button>
          {isDraft && (
            <Button variant="secondary" size="sm" onClick={openSectionsModal}>
              <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" /></svg>
              Sections
            </Button>
          )}
          {isDraft && (
            <Button
              variant={application.is_locked ? 'secondary' : 'secondary'}
              size="sm"
              onClick={handleToggleLock}
              loading={togglingLock}
              disabled={togglingLock}
              className={application.is_locked ? 'text-amber-600 border-amber-500/40 hover:bg-amber-50' : ''}
            >
              {application.is_locked ? (
                <>
                  <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                  Unlock
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                  Lock
                </>
              )}
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <svg className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            Delete
          </Button>
        </div>
      </div>

      {/* Status Timeline */}
      <GlassCard className="mb-6">
        <h2 className="text-[13px] font-medium text-muted-foreground mb-4">Application Progress</h2>
        <StatusTimeline currentStatus={application.status} />
      </GlassCard>

      {/* High alerts — broker/admin only, surfaced prominently at the top */}
      {(currentUser?.role === 'admin' || currentUser?.role === 'broker') && alerts.some((a) => a.is_high_priority) && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/8 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="h-5 w-5 text-destructive shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
            <p className="text-[13px] font-semibold text-destructive">High alert{alerts.filter((a) => a.is_high_priority).length > 1 ? 's' : ''}</p>
          </div>
          <div className="space-y-2.5">
            {alerts.filter((a) => a.is_high_priority).map((alert) => (
              <div key={alert.id} className="rounded-xl bg-background/40 border border-destructive/15 px-3.5 py-2.5">
                <p className="text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">{alert.content}</p>
                <p className="text-[11px] text-muted-foreground mt-1.5">{alert.author_name || 'Staff'} · {formatDateTime(alert.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Client not yet released / invited — top-level banner so it's always visible */}
      {(application.client_account_pending || application.hidden_from_client) && (currentUser?.role === 'admin' || currentUser?.role === 'broker') && (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-50/60 dark:bg-amber-950/20 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
            <div>
              {application.hidden_from_client ? (
                <>
                  <p className="text-[13px] font-semibold text-foreground">Hidden from the client's portal</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">The client can't see this application yet. Configure which form sections they should fill, then release it by inviting them.</p>
                </>
              ) : application.client_invite_sent_at ? (
                <>
                  <p className="text-[13px] font-semibold text-foreground">Waiting for client to set up their account</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">Invite sent {formatDate(application.client_invite_sent_at)}. Resend if the client hasn't received it.</p>
                </>
              ) : (
                <>
                  <p className="text-[13px] font-semibold text-foreground">Client hasn't been invited yet</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">Configure the form sections if needed, then send the invite to the client.</p>
                </>
              )}
            </div>
          </div>
          <Button size="sm" onClick={handleInviteClient} loading={invitingClient}>
            {application.hidden_from_client ? 'Release to Client' : application.client_invite_sent_at ? 'Resend Invite' : 'Invite Client'}
          </Button>
        </div>
      )}

      {(application.invite_url || clientInviteLink) && (currentUser?.role === 'admin' || currentUser?.role === 'broker') && (
        <div className="mb-6">
          <InviteLinkBox
            url={(application.invite_url || clientInviteLink)!}
            label="Client invite link"
            hint={application.client_invite_sent_at
              ? 'Also emailed to the client. Copy it to share another way (e.g. SMS or WhatsApp).'
              : 'Share this link directly, or click Invite Client to email it — both use the same link.'}
            onDismiss={application.invite_url ? undefined : () => setClientInviteLink(null)}
          />
        </div>
      )}

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
                    <div>
                      <h1 className="text-[20px] sm:text-[28px] font-semibold text-foreground capitalize tracking-tight">
                        {application.loan_type} Loan
                      </h1>
                      <p className="mt-1 text-[14px] font-medium text-muted-foreground">
                        {displayName}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge value={application.status} />
                      {application.is_locked && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 ring-1 ring-amber-500/20">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                          Client Locked
                        </span>
                      )}
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
                          <select {...regEdit('loan_type')} className="led-input">
                            <option value="personal">Personal</option>
                            <option value="home">Home</option>
                            <option value="business">Business</option>
                            <option value="vehicle">Vehicle</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[13px] font-medium text-muted-foreground mb-2">Amount ($)</label>
                          <input type="number" step="0.01" placeholder="Enter amount" className="led-input"
                            {...regEdit('amount', { validate: v => !v || parseFloat(v) > 0 || 'Must be greater than 0' })} />
                          {editErrors.amount && <p className="text-[12px] text-destructive mt-1">{editErrors.amount.message}</p>}
                        </div>
                      </div>

                      {/* Applicant */}
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

                      {/* Address */}
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

                      {/* Contact */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Contact</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Email</label>
                          <input type="email" className="led-input" {...regEdit('applicant_email')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Mobile</label>
                          <input type="text" className="led-input" {...regEdit('applicant_mobile')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Preferred Contact</label>
                          <select {...regEdit('preferred_contact_method')} className="led-input">
                            <option value="">Select...</option>
                            {['Email', 'Phone', 'Mobile'].map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* ID & Residency */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">ID & Residency</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">ID Type</label>
                          <select {...regEdit('id_type')} className="led-input">
                            <option value="license">Driver Licence</option>
                            <option value="passport">Passport</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">ID Number</label>
                          <input type="text" className="led-input" {...regEdit('id_number')} placeholder={watchEdit('id_type') === 'passport' ? 'PA1234567' : '12345678'} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">{watchEdit('id_type') === 'passport' ? 'Issuing Country' : 'Issuing State'}</label>
                          <input type="text" className="led-input" {...regEdit('id_issuing_state_country')} placeholder={watchEdit('id_type') === 'passport' ? 'Australia' : 'NSW'} />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">ID Expiry Date</label>
                          <DatePicker
                            label="ID Expiry"
                            value={watchEdit('id_expiry_date') || ''}
                            onChange={(v) => setValueEdit('id_expiry_date', v, { shouldValidate: true })}
                            className="led-input"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Residency Status</label>
                          <select {...regEdit('applicant_residency_status')} className="led-input">
                            <option value="">Select...</option>
                            {['Australian Citizen', 'Permanent Resident', 'Temporary Resident', 'Visa Holder'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Living Situation */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Living Situation</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Residential Status</label>
                          <select {...regEdit('residential_status')} className="led-input">
                            <option value="">Select...</option>
                            {['Renting', 'Owning', 'Mortgage', 'Living with Family', 'Other'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Time at Address</label>
                          <input type="text" placeholder="e.g. 2 years" className="led-input" {...regEdit('time_at_address')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Dependants</label>
                          <input type="number" min="0" className="led-input" {...regEdit('applicant_num_dependants')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Has Partner</label>
                          <select {...regEdit('has_partner')} className="led-input">
                            <option value="">Select...</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Partner Working</label>
                          <select {...regEdit('partner_working')} className="led-input">
                            <option value="">Select...</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </div>
                      </div>

                      {/* Employment */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Employment</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Employment Category</label>
                          <select {...regEdit('employment_category')} className="led-input">
                            <option value="">Select...</option>
                            {['Full Time', 'Part Time', 'Casual', 'Self Employed', 'Contractor', 'Unemployed', 'Retired', 'Other'].map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Employer Name</label>
                          <input type="text" className="led-input" {...regEdit('employer_name')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Industry</label>
                          <input type="text" className="led-input" {...regEdit('employer_industry')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Job Title</label>
                          <input type="text" className="led-input" {...regEdit('job_title')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Income Frequency</label>
                          <select {...regEdit('income_frequency')} className="led-input">
                            <option value="">Select...</option>
                            {['Weekly', 'Fortnightly', 'Monthly', 'Annually'].map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Gross Income ($)</label>
                          <input type="number" min="0" step="0.01" className="led-input" {...regEdit('gross_income')} />
                        </div>
                      </div>

                      {/* Business */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Business</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Business Name</label>
                          <input type="text" className="led-input" {...regEdit('business_name')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Trading Name</label>
                          <input type="text" className="led-input" {...regEdit('trading_name')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">ABN</label>
                          <input type="text" className="led-input" {...regEdit('business_abn')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Business Structure</label>
                          <select {...regEdit('business_structure')} className="led-input">
                            <option value="">Select...</option>
                            {['Sole Trader', 'Partnership', 'Company', 'Trust', 'Other'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Registration Date</label>
                          <DatePicker
                            label="Registration Date"
                            value={watchEdit('business_registration_date') || ''}
                            onChange={(v) => setValueEdit('business_registration_date', v, { shouldValidate: true })}
                            className="led-input"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Industry ID</label>
                          <input type="number" className="led-input" {...regEdit('business_industry_id')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Monthly Sales ($)</label>
                          <input type="number" min="0" step="0.01" className="led-input" {...regEdit('business_monthly_sales')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">GST Registered</label>
                          <select {...regEdit('gst_registered')} className="led-input">
                            <option value="">Select...</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Directors</label>
                          <input type="number" min="0" className="led-input" {...regEdit('num_directors')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Time Trading</label>
                          <input type="text" placeholder="e.g. 3 years" className="led-input" {...regEdit('time_trading')} />
                        </div>
                      </div>

                      {/* Loan terms */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Loan Details</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Term (years)</label>
                          <input type="number" min="0" max="30" className="led-input" {...regEdit('loan_term_years')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Term (months)</label>
                          <input type="number" min="0" max="11" className="led-input" {...regEdit('loan_term_months')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Purpose ID</label>
                          <input type="number" className="led-input" {...regEdit('loan_purpose_id')} />
                        </div>
                      </div>

                      {/* Declarations */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Declarations</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Previously Declined</label>
                          <select {...regEdit('previously_declined')} className="led-input">
                            <option value="">Select...</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Change of Circumstances</label>
                          <select {...regEdit('change_of_circumstances')} className="led-input">
                            <option value="">Select...</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Signature Name</label>
                          <input type="text" className="led-input" {...regEdit('signature_name')} />
                        </div>
                      </div>

                      {/* Emergency Contact */}
                      <h3 className="text-[13px] font-medium text-muted-foreground">Emergency Contact</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Name</label>
                          <input type="text" className="led-input" {...regEdit('emergency_contact_name')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Relationship</label>
                          <input type="text" className="led-input" {...regEdit('emergency_contact_relationship')} />
                        </div>
                        <div>
                          <label className="block text-[12px] text-muted-foreground mb-1">Phone</label>
                          <input type="text" className="led-input" {...regEdit('emergency_contact_phone')} />
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="block text-[13px] font-medium text-muted-foreground mb-2">Notes</label>
                        <textarea
                          rows={3}
                          className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
                          placeholder="Application notes..."
                          {...regEdit('notes')}
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        <Button onClick={handleEditSubmit(handleSaveEditFields)} loading={savingEditFields}>Save Changes</Button>
                        <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <dl className="space-y-6">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl bg-secondary p-4">
                          <dt className="text-[13px] font-medium text-muted-foreground">Amount</dt>
                          <dd className="mt-1 text-[28px] font-semibold text-foreground tracking-tight">${Number(application.amount).toLocaleString('en-AU')}</dd>
                        </div>
                        <div className="rounded-xl bg-secondary p-4">
                          <dt className="text-[13px] font-medium text-muted-foreground">Loan Type</dt>
                          <dd className="mt-1 text-[28px] font-semibold text-foreground capitalize tracking-tight">{application.loan_type.replace(/_/g, ' ')}</dd>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <dt className="text-[12px] text-muted-foreground">Loan Term</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                            {application.loan_term_requested
                              ? `${Math.floor(application.loan_term_requested / 12)}y ${application.loan_term_requested % 12}m`
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[12px] text-muted-foreground">Loan Purpose ID</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.loan_purpose_id ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] text-muted-foreground">Created</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{formatDate(application.created_at)}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] text-muted-foreground">Last Updated</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{formatDate(application.updated_at)}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-[12px] text-muted-foreground">Notes</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.notes || '—'}</dd>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Personal</h3>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Title</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_title || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">First Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_first_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Middle Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_middle_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Last Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_last_name || '—'}</dd>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3 mt-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Date of Birth</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_dob || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Gender</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_gender || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Marital Status</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_marital_status || '—'}</dd>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Address</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="sm:col-span-3">
                            <dt className="text-[12px] text-muted-foreground">Street Address</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_address || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Suburb</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_suburb || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">State</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_state || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Postcode</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_postcode || '—'}</dd>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Contact</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Email</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_email || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Mobile</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_mobile || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Preferred Contact</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.preferred_contact_method || '—'}</dd>
                          </div>
                        </div>
                      </div>

                      {(() => {
                        let idEntry: Record<string, string> | null = null;
                        try {
                          const extra = application.lend_extra_data ? JSON.parse(application.lend_extra_data) : {};
                          idEntry = Array.isArray(extra.identification) ? extra.identification[0] : null;
                        } catch { /* ignore malformed extra data */ }
                        return (
                          <div className="border-t border-border pt-5">
                            <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Identification & Residency</h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <dt className="text-[12px] text-muted-foreground">ID Type</dt>
                                <dd className="mt-0.5 text-[14px] font-medium text-foreground">{idEntry?.type || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-[12px] text-muted-foreground">ID Number</dt>
                                <dd className="mt-0.5 text-[14px] font-medium text-foreground">{idEntry?.number || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-[12px] text-muted-foreground">{idEntry?.country ? 'Issuing Country' : 'Issuing State'}</dt>
                                <dd className="mt-0.5 text-[14px] font-medium text-foreground">{idEntry?.state || idEntry?.country || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-[12px] text-muted-foreground">ID Expiry Date</dt>
                                <dd className="mt-0.5 text-[14px] font-medium text-foreground">{idEntry?.expiry_date || application.id_expiry_date || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-[12px] text-muted-foreground">Residency Status</dt>
                                <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_residency_status || '—'}</dd>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Living Situation</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Residential Status</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.residential_status || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Time at Address</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.time_at_address || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Dependants</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.applicant_num_dependants ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Has Partner</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.has_partner === null ? '—' : application.has_partner ? 'Yes' : 'No'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Partner Working</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.partner_working === null ? '—' : application.partner_working ? 'Yes' : 'No'}
                            </dd>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Employment</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Employment Category</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.employment_category || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Employer Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.employer_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Industry</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.employer_industry || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Job Title</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.job_title || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Income Frequency</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.income_frequency || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Gross Income</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.gross_income != null ? `$${Number(application.gross_income).toLocaleString('en-AU')}` : '—'}
                            </dd>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Business</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Business Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">ABN</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_abn || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Registration Date</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_registration_date || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Industry ID</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_industry_id ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Monthly Sales</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.business_monthly_sales != null ? `$${Number(application.business_monthly_sales).toLocaleString('en-AU')}` : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Trading Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.trading_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Business Structure</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.business_structure || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">GST Registered</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.gst_registered === null ? '—' : application.gst_registered ? 'Yes' : 'No'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Directors</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.num_directors ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Time Trading</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.time_trading || '—'}</dd>
                          </div>
                        </div>
                      </div>

                      <DirectorsSection
                        application={application}
                        onChange={refetchApplication}
                        canManage
                        canReconcile
                      />

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Declarations</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Previously Declined</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.previously_declined === null ? '—' : application.previously_declined ? 'Yes' : 'No'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Change of Circumstances</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                              {application.change_of_circumstances === null ? '—' : application.change_of_circumstances ? 'Yes' : 'No'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Signature Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.signature_name || '—'}</dd>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Emergency Contact</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Name</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Relationship</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_relationship || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Phone</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.emergency_contact_phone || '—'}</dd>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border pt-5">
                        <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Lend Controls</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Product Type ID</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.lend_product_type_id ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Owner Type</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.lend_owner_type || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Send Type</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.lend_send_type || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Who to Contact</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.lend_who_to_contact || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted-foreground">Lend Ref</dt>
                            <dd className="mt-0.5 text-[14px] font-medium text-foreground">{application.lend_ref || '—'}</dd>
                          </div>
                        </div>
                      </div>
                    </dl>
                  )}
                </GlassCard>

                {/* Comprehensive Loan Type Details */}
                {application.lend_extra_data && (() => {
                  try {
                    const extraData = JSON.parse(application.lend_extra_data);
                    const loanDetails = extraData.loan_type_details;
                    if (!loanDetails) return null;

                    return (
                      <GlassCard>
                        <h2 className="text-[15px] font-semibold text-foreground mb-5">Loan Type Details</h2>
                        <div className="space-y-4">
                          {/* Consumer Loan Type */}
                          {loanDetails.consumer_loan_type && (
                            <div className="rounded-xl bg-secondary p-4">
                              <p className="text-[13px] font-medium text-muted-foreground">Consumer Loan Type</p>
                              <p className="mt-1 text-[16px] font-semibold text-foreground">{loanDetails.consumer_loan_type.label}</p>
                            </div>
                          )}

                          {/* Commercial Loan Type */}
                          {loanDetails.commercial_loan_type && (
                            <div className="rounded-xl bg-secondary p-4">
                              <p className="text-[13px] font-medium text-muted-foreground">Commercial Loan Type</p>
                              <p className="mt-1 text-[16px] font-semibold text-foreground">{loanDetails.commercial_loan_type.label}</p>
                            </div>
                          )}

                          {/* Vehicle Details */}
                          {loanDetails.vehicle_details && (
                            <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                              <p className="text-[13px] font-semibold text-foreground">Vehicle Information</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {loanDetails.vehicle_details.make && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Make</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.make}</p>
                                  </div>
                                )}
                                {loanDetails.vehicle_details.model && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Model</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.model}</p>
                                  </div>
                                )}
                                {loanDetails.vehicle_details.year && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Year</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.year}</p>
                                  </div>
                                )}
                                {loanDetails.vehicle_details.condition && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Condition</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.vehicle_details.condition}</p>
                                  </div>
                                )}
                                {loanDetails.vehicle_details.price > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Price</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.vehicle_details.price).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.vehicle_details.deposit > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Deposit</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.vehicle_details.deposit).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Property Details */}
                          {loanDetails.property_details && (
                            <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                              <p className="text-[13px] font-semibold text-foreground">Property Information</p>
                              {loanDetails.property_details.address && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Address</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.address}</p>
                                </div>
                              )}
                              <div className="grid gap-3 sm:grid-cols-2">
                                {loanDetails.property_details.property_type && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Property Type</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.property_type}</p>
                                  </div>
                                )}
                                {loanDetails.property_details.property_use && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Property Use</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.property_use}</p>
                                  </div>
                                )}
                                {loanDetails.property_details.value > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Property Value</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.property_details.value).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.property_details.deposit > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Deposit</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.property_details.deposit).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.property_details.first_home_buyer !== undefined && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">First Home Buyer</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.first_home_buyer ? 'Yes' : 'No'}</p>
                                  </div>
                                )}
                                {loanDetails.property_details.current_lender && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Current Lender</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.current_lender}</p>
                                  </div>
                                )}
                              </div>
                              {loanDetails.property_details.refinance_reason && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Refinance Reason</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.property_details.refinance_reason}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Asset/Equipment Details */}
                          {loanDetails.asset_details && (
                            <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                              <p className="text-[13px] font-semibold text-foreground">Asset Information</p>
                              {loanDetails.asset_details.equipment_type && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Asset Type</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.equipment_type}</p>
                                </div>
                              )}
                              {loanDetails.asset_details.description && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Description</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.description}</p>
                                </div>
                              )}
                              <div className="grid gap-3 sm:grid-cols-2">
                                {loanDetails.asset_details.price > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Price</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.asset_details.price).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.asset_details.deposit > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Deposit</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.asset_details.deposit).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.asset_details.vendor_type && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Vendor Type</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.vendor_type}</p>
                                  </div>
                                )}
                                {loanDetails.asset_details.business_use_pct > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Business Use %</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.asset_details.business_use_pct}%</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Business Details */}
                          {loanDetails.business_details && (
                            <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                              <p className="text-[13px] font-semibold text-foreground">Business Information</p>
                              {loanDetails.business_details.business_plan && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Business Plan</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.business_plan}</p>
                                </div>
                              )}
                              {loanDetails.business_details.business_details && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Business Details</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.business_details}</p>
                                </div>
                              )}
                              <div className="grid gap-3 sm:grid-cols-2">
                                {loanDetails.business_details.startup_costs > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Startup Costs</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.business_details.startup_costs).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.business_details.purchase_price > 0 && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Purchase Price</p>
                                    <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.business_details.purchase_price).toLocaleString('en-AU')}</p>
                                  </div>
                                )}
                                {loanDetails.business_details.industry && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Industry</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.industry}</p>
                                  </div>
                                )}
                                {loanDetails.business_details.business_type && (
                                  <div>
                                    <p className="text-[12px] text-muted-foreground">Business Type</p>
                                    <p className="text-[14px] font-medium text-foreground">{loanDetails.business_details.business_type}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Working Capital Details */}
                          {loanDetails.working_capital && (
                            <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                              <p className="text-[13px] font-semibold text-foreground">Working Capital Details</p>
                              {loanDetails.working_capital.expansion_description && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Expansion Plans</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.expansion_description}</p>
                                </div>
                              )}
                              {loanDetails.working_capital.recruitment_details && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Recruitment Details</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.recruitment_details}</p>
                                </div>
                              )}
                              {loanDetails.working_capital.supplier_details && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Supplier Details</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.supplier_details}</p>
                                </div>
                              )}
                              {loanDetails.working_capital.outstanding_invoices && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Outstanding Invoices</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.outstanding_invoices}</p>
                                </div>
                              )}
                              {loanDetails.working_capital.purpose_description && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Purpose</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.working_capital.purpose_description}</p>
                                </div>
                              )}
                              {loanDetails.working_capital.loan_amount > 0 && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Loan Amount</p>
                                  <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.working_capital.loan_amount).toLocaleString('en-AU')}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Personal Loan Details */}
                          {loanDetails.personal_loan && (
                            <div className="rounded-xl bg-secondary/50 p-4 space-y-3">
                              <p className="text-[13px] font-semibold text-foreground">Personal Loan Details</p>
                              {loanDetails.personal_loan.purpose && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Purpose</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.personal_loan.purpose}</p>
                                </div>
                              )}
                              {loanDetails.personal_loan.amount > 0 && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Amount</p>
                                  <p className="text-[14px] font-medium text-foreground">${Number(loanDetails.personal_loan.amount).toLocaleString('en-AU')}</p>
                                </div>
                              )}
                              {loanDetails.personal_loan.term && (
                                <div>
                                  <p className="text-[12px] text-muted-foreground">Term</p>
                                  <p className="text-[14px] font-medium text-foreground">{loanDetails.personal_loan.term}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </GlassCard>
                    );
                  } catch {
                    return null;
                  }
                })()}

                {/* Financial Position — always shown, with empty-state placeholders */}
                {(() => {
                  let extra: Record<string, unknown> = {};
                  try { extra = application.lend_extra_data ? JSON.parse(application.lend_extra_data) : {}; } catch { extra = {}; }
                  const empEntry = Array.isArray(extra.employments) ? (extra.employments as Array<Record<string, string>>)[0] : null;
                  const incomes = Array.isArray(extra.incomes) ? (extra.incomes as Array<{ income_type?: string; amount?: number; frequency?: string }>).filter(i => (i.amount ?? 0) > 0) : [];
                  const realEstateAssets: Array<Record<string, any>> = Array.isArray((extra.assets as Record<string, any> | undefined)?.real_estate) ? (extra.assets as Record<string, any[]>).real_estate as Array<Record<string, any>> : [];
                  const otherAssets: Array<Record<string, any>> = Array.isArray((extra.assets as Record<string, any> | undefined)?.other) ? (extra.assets as Record<string, any[]>).other as Array<Record<string, any>> : [];
                  const liabs: Array<Record<string, any>> = Array.isArray(extra.liabilities) ? extra.liabilities as Array<Record<string, any>> : [];
                  const expenses = (extra.expenses as Record<string, number> | undefined) || {};
                  const emptyHint = <p className="text-[13px] text-muted-foreground">Not provided</p>;
                  return (
                    <GlassCard>
                      <h2 className="text-[15px] font-semibold text-foreground mb-5">Financial Position</h2>
                      <div className="space-y-5">

                        {/* Employment Details */}
                        <div className="border-b border-border pb-4">
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Employment Details</h3>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div><p className="text-[12px] text-muted-foreground">Employment Type</p><p className="text-[14px] font-medium text-foreground">{empEntry?.employment_type || '—'}</p></div>
                            <div><p className="text-[12px] text-muted-foreground">Start Date</p><p className="text-[14px] font-medium text-foreground">{empEntry?.start_date || '—'}</p></div>
                            <div><p className="text-[12px] text-muted-foreground">Employer Contact</p><p className="text-[14px] font-medium text-foreground">{empEntry?.contact_details || '—'}</p></div>
                          </div>
                        </div>

                        {/* Income */}
                        <div className="border-b border-border pb-4">
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Income</h3>
                          {incomes.length > 0 ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {incomes.map((inc, i) => (
                                <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                  <p className="text-[12px] text-muted-foreground">{i === 0 ? 'Primary Income' : `Additional Income ${i}`}</p>
                                  <p className="text-[14px] font-medium text-foreground">{inc.income_type}{inc.amount ? ` — $${Number(inc.amount).toLocaleString('en-AU')}` : ''}{inc.frequency ? ` / ${inc.frequency}` : ''}</p>
                                </div>
                              ))}
                            </div>
                          ) : emptyHint}
                        </div>

                        {/* Expenses */}
                        <div className="border-b border-border pb-4">
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Monthly Expenses</h3>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Living Expenses</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.monthly_living || 0).toLocaleString('en-AU')}/mo</p></div>
                            <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Rent / Mortgage</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.rent_mortgage || 0).toLocaleString('en-AU')}/mo</p></div>
                            <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Child Support</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.child_support || 0).toLocaleString('en-AU')}/mo</p></div>
                            <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[12px] text-muted-foreground">Other Commitments</p><p className="text-[14px] font-medium text-foreground">${Number(expenses.other_commitments || 0).toLocaleString('en-AU')}/mo</p></div>
                          </div>
                        </div>

                        {/* Real Estate Assets */}
                        <div className="border-b border-border pb-4">
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Real Estate Assets</h3>
                          {realEstateAssets.length > 0 ? (
                            <div className="space-y-2">
                              {realEstateAssets.map((asset, i) => (
                                <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                  <p className="text-[13px] font-medium text-foreground">{String(asset.property_type || `Property ${i + 1}`)}</p>
                                  {asset.address && <p className="text-[13px] text-muted-foreground mt-0.5">{String(asset.address)}</p>}
                                  <div className="flex gap-4 flex-wrap mt-1.5">
                                    {(asset.estimated_value as number) > 0 && <span className="text-[12px] text-foreground">Value: ${Number(asset.estimated_value).toLocaleString('en-AU')}</span>}
                                    {asset.ownership_type && <span className="text-[12px] text-muted-foreground">Ownership: {String(asset.ownership_type)}</span>}
                                    {asset.is_financed === 'yes' && asset.lender && <span className="text-[12px] text-muted-foreground">Lender: {String(asset.lender)}</span>}
                                    {asset.is_financed === 'yes' && (asset.amount_owing as number) > 0 && <span className="text-[12px] text-muted-foreground">Owing: ${Number(asset.amount_owing).toLocaleString('en-AU')}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : emptyHint}
                        </div>

                        {/* Other Assets */}
                        <div className="border-b border-border pb-4">
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Other Assets</h3>
                          {otherAssets.length > 0 ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {otherAssets.map((asset, i) => (
                                <div key={i} className="rounded-xl bg-secondary/50 p-3">
                                  <p className="text-[12px] text-muted-foreground">{String(asset.asset_type || `Asset ${i + 1}`)}</p>
                                  {(asset.value as number) > 0 && <p className="text-[14px] font-medium text-foreground">${Number(asset.value).toLocaleString('en-AU')}</p>}
                                </div>
                              ))}
                            </div>
                          ) : emptyHint}
                        </div>

                        {/* Liabilities */}
                        <div>
                          <h3 className="text-[13px] font-semibold text-muted-foreground mb-3">Liabilities</h3>
                          {liabs.length > 0 ? (
                            <div className="space-y-2">
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
                          ) : emptyHint}
                        </div>
                      </div>
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
                      {documents.length > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8"
                          onClick={handleDownloadAll}
                          loading={downloadingAll}
                        >
                          <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          Download All
                        </Button>
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
                        <Button size="sm" variant="primary" onClick={handleSubmitDocRequest} disabled={!docRequestItems.some((s) => s.trim()) || submittingDocRequest} loading={submittingDocRequest}>
                          Send Request
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowDocRequestForm(false); setDocRequestItems(['']); }}>
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
                {displayName !== '—' && (
                  <GlassCard>
                    <h2 className="text-[15px] font-semibold text-foreground mb-5">Applicant Details</h2>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                          {displayName}
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

                {/* Referrer — admin/broker only (this whole page is staff-gated) */}
                {referrer && (
                  <GlassCard>
                    <h2 className="text-[15px] font-semibold text-foreground mb-5">Referrer</h2>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Name</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">{referrer.full_name || '—'}</dd>
                      </div>
                      {referrer.organization_name && (
                        <div className="rounded-xl bg-secondary/50 p-3">
                          <dt className="text-[12px] font-medium text-muted-foreground">Organization</dt>
                          <dd className="mt-0.5 text-[14px] font-medium text-foreground">{referrer.organization_name}</dd>
                        </div>
                      )}
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Email</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                          {referrer.email ? <a href={`mailto:${referrer.email}`} className="text-primary hover:underline">{referrer.email}</a> : '—'}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-secondary/50 p-3">
                        <dt className="text-[12px] font-medium text-muted-foreground">Phone</dt>
                        <dd className="mt-0.5 text-[14px] font-medium text-foreground">
                          {referrer.phone ? <a href={`tel:${referrer.phone}`} className="text-primary hover:underline">{referrer.phone}</a> : '—'}
                        </dd>
                      </div>
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
                                {sub.offered_amount != null && <div>Amount: ${Number(sub.offered_amount).toLocaleString('en-AU')}</div>}
                                {sub.conditions && <div className="sm:col-span-2">Conditions: {sub.conditions}</div>}
                                {sub.notes && <div className="sm:col-span-2">Notes: {sub.notes}</div>}
                              </div>
                              {(() => {
                                const contacts = availableLenders.find(l => l.id === sub.lender_id)?.contacts ?? [];
                                return contacts.length > 0 ? (
                                  <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap gap-x-5 gap-y-1">
                                    {contacts.map(c => (
                                      <div key={c.id} className="text-[12px] text-muted-foreground">
                                        <span className="font-medium text-foreground/80">{c.name}</span>
                                        {c.designation && <span className="ml-1">· {c.designation}</span>}
                                        {c.email && <a href={`mailto:${c.email}`} className="ml-1 hover:text-foreground transition-colors">{c.email}</a>}
                                        {c.phone && <a href={`tel:${c.phone}`} className="ml-1 hover:text-foreground transition-colors">{c.phone}</a>}
                                      </div>
                                    ))}
                                  </div>
                                ) : null;
                              })()}
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
                      { key: 'referrer_messages' as const, label: 'Message to Ref' },
                      { key: 'client_messages' as const, label: 'Message to client' },
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

                  {/* Message to Ref tab */}
                  {msgTab === 'referrer_messages' && (
                    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
                      {!referrer ? (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                          <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                            <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                          </div>
                          <p className="text-[13px] font-medium text-muted-foreground">No ref associated with this contact</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 mb-3">
                            {referrerMessages.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full gap-2 opacity-60">
                                <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                                <p className="text-[13px] text-muted-foreground">No messages yet</p>
                              </div>
                            ) : (
                              referrerMessages.map((msg) => {
                                const isOwn = msg.author_id === currentUser?.id;
                                const isPinned = pinnedMsgIds.has(msg.id);
                                return (
                                  <div key={msg.id} className={`group flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                                    <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                                      <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || referrer.full_name)}</span>
                                      <span className="text-[11px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                                      <button
                                        onClick={() => handlePinMessageToDealNotes(msg, isOwn ? 'your' : (msg.author_name || referrer.full_name))}
                                        disabled={pinningMsgId === msg.id || isPinned}
                                        className={`transition-opacity p-0.5 rounded ${isPinned ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
                                        title={isPinned ? 'Added to deal notes' : 'Add to deal notes'}
                                      >
                                        {isPinned ? (
                                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" /></svg>
                                        ) : (
                                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
                                        )}
                                      </button>
                                      {!isOwn && (
                                        <button
                                          onClick={async () => {
                                            if (!referrer?.id) return;
                                            try {
                                              await api.delete(`/clients/${referrer.id}/messages/${msg.id}`);
                                              setReferrerMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                            } catch {}
                                          }}
                                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                          title="Delete"
                                        >
                                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                        </button>
                                      )}
                                    </div>
                                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm'}`}>
                                      <p className="whitespace-pre-wrap">{msg.content}</p>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                          <div className="rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 transition-colors flex flex-col">
                            <textarea
                              value={newRefMsgContent}
                              onChange={(e) => setNewRefMsgContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  if (!referrer?.id || referrer.id === currentUser?.id || !newRefMsgContent.trim()) return;
                                  setSendingRefMsg(true);
                                  api.post(`/clients/${referrer.id}/messages`, { content: newRefMsgContent.trim(), recipient_id: referrer.id, application_id: id })
                                    .then(({ data }) => { setReferrerMessages((prev) => [...prev, data]); setNewRefMsgContent(''); toast('Message sent', 'success'); })
                                    .catch((err: unknown) => toast(getErrorMessage(err, 'Failed to send'), 'error'))
                                    .finally(() => setSendingRefMsg(false));
                                }
                              }}
                              rows={2}
                              disabled={referrer.id === currentUser?.id}
                              className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none disabled:opacity-60"
                              placeholder={referrer.id === currentUser?.id ? "This is your own application — you can't message yourself." : `Message ${referrer.full_name}…`}
                            />
                            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                              <span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for new line</span>
                              <Button
                                size="sm"
                                className="rounded-xl h-8 px-3.5"
                                loading={sendingRefMsg}
                                disabled={!newRefMsgContent.trim() || !referrer?.id || referrer.id === currentUser?.id}
                                onClick={async () => {
                                  if (!referrer?.id || referrer.id === currentUser?.id || !newRefMsgContent.trim()) return;
                                  setSendingRefMsg(true);
                                  try {
                                    const { data } = await api.post(`/clients/${referrer.id}/messages`, { content: newRefMsgContent.trim(), recipient_id: referrer.id, application_id: id });
                                    setReferrerMessages((prev) => [...prev, data]);
                                    setNewRefMsgContent('');
                                    toast('Message sent', 'success');
                                  } catch (err: unknown) {
                                    toast(getErrorMessage(err, 'Failed to send'), 'error');
                                  } finally {
                                    setSendingRefMsg(false);
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
                  )}

                  {/* Client Messages tab */}
                  {msgTab === 'client_messages' && (
                    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
                      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 mb-3">
                        {clientMessages.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-60">
                            <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                            <p className="text-[13px] text-muted-foreground">No messages yet</p>
                          </div>
                        ) : (
                          clientMessages.map((msg) => {
                            const isOwn = msg.author_id === currentUser?.id;
                            const isPinned = pinnedMsgIds.has(msg.id);
                            return (
                              <div key={msg.id} className={`group flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                                <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                                  <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || 'Client')}</span>
                                  <span className="text-[11px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                                  <button
                                    onClick={() => handlePinMessageToDealNotes(msg, isOwn ? 'your' : (msg.author_name || 'the client'))}
                                    disabled={pinningMsgId === msg.id || isPinned}
                                    className={`transition-opacity p-0.5 rounded ${isPinned ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
                                    title={isPinned ? 'Added to deal notes' : 'Add to deal notes'}
                                  >
                                    {isPinned ? (
                                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" /></svg>
                                    ) : (
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
                                    )}
                                  </button>
                                  {!isOwn && (
                                    <button
                                      onClick={async () => {
                                        if (!client?.id) return;
                                        try {
                                          await api.delete(`/clients/${client.id}/messages/${msg.id}`);
                                          setClientMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                        } catch {}
                                      }}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                      title="Delete"
                                    >
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                    </button>
                                  )}
                                </div>
                                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm'}`}>
                                  <p className="whitespace-pre-wrap">{msg.content}</p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 transition-colors flex flex-col">
                        <textarea
                          value={newClientMsgContent}
                          onChange={(e) => setNewClientMsgContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (!client?.id || client.id === currentUser?.id || !newClientMsgContent.trim()) return;
                              setSendingClientMsg(true);
                              api.post(`/clients/${client.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: client.id, application_id: id })
                                .then(({ data }) => { setClientMessages((prev) => [...prev, data]); setNewClientMsgContent(''); toast('Message sent', 'success'); })
                                .catch((err: unknown) => toast(getErrorMessage(err, 'Failed to send'), 'error'))
                                .finally(() => setSendingClientMsg(false));
                            }
                          }}
                          rows={2}
                          disabled={client?.id === currentUser?.id}
                          className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none disabled:opacity-60"
                          placeholder={client?.id === currentUser?.id ? "This is your own application — you can't message yourself." : 'Message the client…'}
                        />
                        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                          <span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for new line</span>
                          <Button
                            size="sm"
                            className="rounded-xl h-8 px-3.5"
                            loading={sendingClientMsg}
                            disabled={!newClientMsgContent.trim() || !client?.id || client?.id === currentUser?.id}
                            onClick={async () => {
                              if (!client?.id || client.id === currentUser?.id || !newClientMsgContent.trim()) return;
                              setSendingClientMsg(true);
                              try {
                                const { data } = await api.post(`/clients/${client.id}/messages`, { content: newClientMsgContent.trim(), recipient_id: client.id, application_id: id });
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

                  {/* Deal Notes tab */}
                  {msgTab === 'deal_notes' && (
                    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
                      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent">
                        {appNotes.filter((n) => n.visibility.length === 1 && (n.visibility[0] === 'broker' || n.visibility[0] === 'personal')).length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
                            <div className="h-12 w-12 rounded-2xl bg-secondary flex items-center justify-center">
                              <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                            </div>
                            <p className="text-[13px] font-medium text-muted-foreground">No deal notes yet</p>
                          </div>
                        ) : (
                          appNotes
                            .filter((n) => n.visibility.length === 1 && (n.visibility[0] === 'broker' || n.visibility[0] === 'personal'))
                            .map((note) => {
                              const isPersonal = note.visibility[0] === 'personal';
                              return (
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
                                          // If this note was pinned from a message, un-check that message.
                                          const srcMsgId = noteSourceMsg[note.id];
                                          if (srcMsgId) {
                                            setPinnedMsgIds((prev) => {
                                              const next = new Set(prev);
                                              next.delete(srcMsgId);
                                              return next;
                                            });
                                            setNoteSourceMsg((prev) => {
                                              const next = { ...prev };
                                              delete next[note.id];
                                              return next;
                                            });
                                          }
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
                                    <span className="text-[11px] font-medium text-muted-foreground">{formatDateTime(note.created_at)}</span>
                                  </div>
                                </div>
                                <div className={`rounded-2xl p-3.5 text-[14px] leading-relaxed text-foreground border ${isPersonal ? 'bg-amber-500/8 border-amber-500/20' : 'bg-secondary/40 border-transparent'}`}>
                                  <p className="whitespace-pre-wrap">{note.content}</p>
                                  <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border/30">
                                    <svg className="h-3.5 w-3.5 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                                    <span className="text-[11px] font-medium opacity-60">{isPersonal ? 'Only you' : 'Internal (Brokers only)'}</span>
                                  </div>
                                </div>
                              </div>
                              );
                            })
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
                        <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-border/30 mt-1">
                          <button
                            type="button"
                            onClick={() => setNoteVisibility((v) => v === 'broker' ? 'personal' : 'broker')}
                            className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-lg transition-colors ${noteVisibility === 'personal' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                            title={noteVisibility === 'personal' ? 'Only visible to you — click to share with team' : 'Visible to all brokers — click to make private'}
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
                            className="rounded-xl px-4 h-9"
                            loading={sendingNote}
                            disabled={!newNoteContent.trim()}
                            onClick={async () => {
                              if (!id || !newNoteContent.trim()) return;
                              setSendingNote(true);
                              try {
                                const { data } = await api.post(`/applications/${id}/notes`, { content: newNoteContent.trim(), visibility: [noteVisibility] });
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
                                  {alert.is_high_priority && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-destructive/15 text-destructive uppercase tracking-wider">High alert</span>
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
                                  <span className="text-[11px] font-medium text-muted-foreground">{formatDateTime(alert.created_at)}</span>
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
                        <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-border/30 mt-1">
                          <button
                            type="button"
                            onClick={() => setNewAlertHighPriority((v) => !v)}
                            aria-pressed={newAlertHighPriority}
                            className={`flex items-center gap-2 text-[12px] font-medium pl-1.5 pr-2.5 py-1 rounded-lg border transition-colors ${newAlertHighPriority ? 'bg-destructive/15 text-destructive border-destructive/40' : 'bg-secondary/60 text-muted-foreground border-border/60 border-dashed hover:text-foreground hover:border-destructive/40'}`}
                            title={newAlertHighPriority ? 'High alert on — shows as a banner on the application page. Click to turn off.' : 'Click to mark as a high alert — it will show as a banner at the top of the application page'}
                          >
                            <span className={`flex items-center justify-center h-4 w-4 rounded-[5px] border transition-colors ${newAlertHighPriority ? 'bg-destructive border-destructive text-white' : 'border-border bg-background'}`}>
                              {newAlertHighPriority && (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                              )}
                            </span>
                            <span className="flex items-center gap-1">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                              {newAlertHighPriority ? 'High alert' : 'Mark as high alert'}
                            </span>
                          </button>
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
                                const { data } = await api.post(`/clients/${client.id}/alerts`, { content: newAlertContent.trim(), is_high_priority: newAlertHighPriority });
                                setAlerts((prev) => [...prev, data]);
                                setNewAlertContent('');
                                setNewAlertHighPriority(false);
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
                  <>
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
                  <ApplicationCalculators applicationId={id!} />
                  </>
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
                        description = `${details.loan_type} loan · $${Number(details.amount || 0).toLocaleString('en-AU')}`;
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

        const S = { section: { marginBottom: '20px' } as CSSProperties, h2: { fontSize: '13px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px' }, grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } as CSSProperties, cell: { background: '#f9fafb', borderRadius: '8px', padding: '8px 10px' } as CSSProperties, label: { fontSize: '11px', color: '#9ca3af', fontWeight: 600 } as CSSProperties, value: { fontSize: '13px', color: '#111827', fontWeight: 500, marginTop: '2px' } as CSSProperties };

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
                  <p style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>${Number(application.amount).toLocaleString('en-AU')}</p>
                </div>
              </div>

              {/* Personal Details */}
              {displayName !== '—' && (
                <div style={S.section}>
                  <h2 style={S.h2}>Applicant Details</h2>
                  <div style={S.grid}>
                    <div style={S.cell}><p style={S.label}>Full Name</p><p style={S.value}>{displayName}</p></div>
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
                    {application.gross_income && <div style={S.cell}><p style={S.label}>Gross Income</p><p style={S.value}>${Number(application.gross_income).toLocaleString('en-AU')}</p></div>}
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
                              <p style={S.value}>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' && k.includes('price') || k.includes('amount') || k.includes('value') || k.includes('cost') || k.includes('deposit') || k.includes('debt') ? `$${Number(v).toLocaleString('en-AU')}` : String(v)}</p>
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
                        <p style={S.value}>{inc.income_type}{inc.amount ? ` — $${Number(inc.amount).toLocaleString('en-AU')}` : ''}{inc.frequency ? ` / ${inc.frequency}` : ''}</p>
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
                    {expenses.monthly_living > 0 && <div style={S.cell}><p style={S.label}>Living Expenses</p><p style={S.value}>${Number(expenses.monthly_living).toLocaleString('en-AU')}/mo</p></div>}
                    {expenses.rent_mortgage > 0 && <div style={S.cell}><p style={S.label}>Rent / Mortgage</p><p style={S.value}>${Number(expenses.rent_mortgage).toLocaleString('en-AU')}/mo</p></div>}
                    {expenses.child_support > 0 && <div style={S.cell}><p style={S.label}>Child Support</p><p style={S.value}>${Number(expenses.child_support).toLocaleString('en-AU')}/mo</p></div>}
                    {expenses.other_commitments > 0 && <div style={S.cell}><p style={S.label}>Other Commitments</p><p style={S.value}>${Number(expenses.other_commitments).toLocaleString('en-AU')}/mo</p></div>}
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
                        {(asset.estimated_value as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Value: ${Number(asset.estimated_value).toLocaleString('en-AU')}</span>}
                        {asset.ownership_type && <span style={{ fontSize: '12px', color: '#374151' }}>Ownership: {String(asset.ownership_type)}</span>}
                        {asset.is_financed === 'yes' && asset.lender && <span style={{ fontSize: '12px', color: '#374151' }}>Lender: {String(asset.lender)}</span>}
                        {asset.is_financed === 'yes' && (asset.amount_owing as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Owing: ${Number(asset.amount_owing).toLocaleString('en-AU')}</span>}
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
                        {(asset.value as number) > 0 && <p style={S.value}>${Number(asset.value).toLocaleString('en-AU')}</p>}
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
                        {(lib.balance as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Balance: ${Number(lib.balance).toLocaleString('en-AU')}</span>}
                        {(lib.limit as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Limit: ${Number(lib.limit).toLocaleString('en-AU')}</span>}
                        {(lib.monthly_repayment as number) > 0 && <span style={{ fontSize: '12px', color: '#374151' }}>Monthly: ${Number(lib.monthly_repayment).toLocaleString('en-AU')}</span>}
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
        />
      )}

      {showSections && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!savingSections) setShowSections(false); }} />
          <div className="relative w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl">
            <h3 className="text-[17px] font-semibold text-foreground mb-1">Client Sections</h3>
            <p className="text-[13px] text-muted-foreground mb-4">
              Choose which sections the client can see and complete. Unticked sections are hidden from the client's form.
            </p>
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                className="text-[12px] font-medium text-primary hover:underline"
                onClick={() => setSectionDraft(APPLICATION_SECTIONS.map(s => s.key))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[12px] font-medium text-muted-foreground hover:underline"
                onClick={() => setSectionDraft([])}
              >
                Clear all
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 mb-4">
              {APPLICATION_SECTIONS.map(s => (
                <label key={s.key} className="flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer hover:bg-secondary transition-colors">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={sectionDraft.includes(s.key)}
                    onChange={() => toggleSectionDraft(s.key)}
                  />
                  <span className="text-[14px] text-foreground">{s.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" size="md" disabled={savingSections} onClick={() => setShowSections(false)}>Cancel</Button>
              <Button variant="primary" size="md" loading={savingSections} onClick={handleSaveSections}>Save</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {reasonModalStatus && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!savingWithReason) { setReasonModalStatus(null); setReasonText(''); } }} />
          <div className="relative w-full max-w-md rounded-2xl bg-background border border-border p-6 shadow-xl">
            <h3 className="text-[17px] font-semibold text-foreground mb-1">
              {reasonModalStatus === 'rejected' ? 'Reject Application' : 'Mark as Not Proceeding'}
            </h3>
            <p className="text-[13px] text-muted-foreground mb-4">
              Record the reason — it will be saved to the application's deal notes.
            </p>
            <textarea
              autoFocus
              rows={4}
              placeholder={reasonModalStatus === 'rejected' ? 'e.g. Insufficient income, credit history issues...' : 'e.g. Client changed their mind, found alternative financing...'}
              value={reasonText}
              onChange={e => setReasonText(e.target.value)}
              className="w-full rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-[14px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none mb-4"
            />
            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                size="md"
                disabled={savingWithReason}
                onClick={() => { if (!savingWithReason) { setReasonModalStatus(null); setReasonText(''); } }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                loading={savingWithReason}
                disabled={!reasonText.trim()}
                onClick={confirmStatusWithReason}
              >
                {reasonModalStatus === 'rejected' ? 'Reject' : 'Mark Not Proceeding'}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
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

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this application?"
        message="This will permanently delete the application, all its documents, notes, and related records. This cannot be undone."
        confirmText="Delete Application"
        cancelText="Cancel"
        variant="danger"
        loading={deletingApp}
        onConfirm={handleDeleteApplication}
        onCancel={() => {
          if (!deletingApp) setConfirmDelete(false);
        }}
      />
    </div>
  );
}
