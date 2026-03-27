import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, Badge, Button } from '../../components/ui';
import StatusTimeline from '../../components/StatusTimeline';
import { formatDate, getInitials } from '../../lib/utils';
import { DOC_TYPE_LABELS } from '../../lib/constants';
import type { Document, LoanApplication, User } from '../../types';

export default function ReferrerApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [client, setClient] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/applications/${id}`),
      api.get(`/documents/application/${id}`),
    ])
      .then(([appRes, docRes]) => {
        setApplication(appRes.data);
        setDocuments(docRes.data);
        // Fetch client details
        if (appRes.data.user_id) {
          api.get(`/users/${appRes.data.user_id}`).then(({ data }) => setClient(data)).catch(() => {});
        }
      })
      .catch(() => toast('Failed to load application', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded-lg shimmer" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-40 rounded-2xl shimmer" />
            <div className="h-32 rounded-2xl shimmer" />
          </div>
          <div className="h-60 rounded-2xl shimmer" />
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Application not found</p>
        <Link to="/referrer/applications" className="mt-4 inline-block text-primary text-[14px] font-medium">
          Back to Applications
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <Link to="/referrer/applications">
          <Button variant="ghost" size="sm">
            <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">
            {application.user_name || 'Client'}'s Application
          </h1>
          <p className="text-[13px] text-muted-foreground capitalize">
            {application.loan_type} Loan &middot; ${Number(application.amount).toLocaleString()}
          </p>
        </div>
        <Badge value={application.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Application Details */}
          <GlassCard>
            <h3 className="text-[15px] font-semibold text-foreground mb-4">Application Details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">Loan Type</p>
                <p className="text-[14px] font-medium text-foreground capitalize">{application.loan_type}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">Amount</p>
                <p className="text-[14px] font-semibold text-foreground">${Number(application.amount).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">Status</p>
                <Badge value={application.status} />
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">Created</p>
                <p className="text-[14px] text-foreground">{formatDate(application.created_at)}</p>
              </div>
              {application.notes && (
                <div className="sm:col-span-2">
                  <p className="text-[12px] text-muted-foreground mb-0.5">Notes</p>
                  <p className="text-[14px] text-foreground whitespace-pre-wrap">{application.notes}</p>
                </div>
              )}
            </div>
          </GlassCard>

          {/* Applicant Details */}
          {(application.applicant_first_name || application.applicant_last_name) && (
            <GlassCard>
              <h3 className="text-[15px] font-semibold text-foreground mb-4">Applicant Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {application.applicant_title && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-0.5">Title</p>
                    <p className="text-[14px] text-foreground">{application.applicant_title}</p>
                  </div>
                )}
                {application.applicant_first_name && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-0.5">First Name</p>
                    <p className="text-[14px] text-foreground">{application.applicant_first_name}</p>
                  </div>
                )}
                {application.applicant_last_name && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-0.5">Last Name</p>
                    <p className="text-[14px] text-foreground">{application.applicant_last_name}</p>
                  </div>
                )}
                {application.applicant_dob && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-0.5">Date of Birth</p>
                    <p className="text-[14px] text-foreground">{application.applicant_dob}</p>
                  </div>
                )}
                {application.applicant_address && (
                  <div className="sm:col-span-2">
                    <p className="text-[12px] text-muted-foreground mb-0.5">Address</p>
                    <p className="text-[14px] text-foreground">
                      {application.applicant_address}
                      {application.applicant_suburb && `, ${application.applicant_suburb}`}
                      {application.applicant_state && ` ${application.applicant_state}`}
                      {application.applicant_postcode && ` ${application.applicant_postcode}`}
                    </p>
                  </div>
                )}
              </div>
            </GlassCard>
          )}

          {/* Business Details */}
          {(application.business_name || application.business_abn) && (
            <GlassCard>
              <h3 className="text-[15px] font-semibold text-foreground mb-4">Business Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {application.business_name && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-0.5">Business Name</p>
                    <p className="text-[14px] text-foreground">{application.business_name}</p>
                  </div>
                )}
                {application.business_abn && (
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-0.5">ABN</p>
                    <p className="text-[14px] text-foreground">{application.business_abn}</p>
                  </div>
                )}
              </div>
            </GlassCard>
          )}

          {/* Documents */}
          <GlassCard>
            <h3 className="text-[15px] font-semibold text-foreground mb-4">
              Documents ({documents.length})
            </h3>
            {documents.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No documents uploaded yet</p>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 rounded-xl bg-secondary/50 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{doc.original_filename}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                        {doc.is_verified && ' \u2022 Verified'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Client Info */}
          <GlassCard>
            <h3 className="text-[15px] font-semibold text-foreground mb-4">Client</h3>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                <span className="text-[13px] font-semibold text-muted-foreground">
                  {getInitials(application.user_name || 'U')}
                </span>
              </div>
              <div>
                <p className="text-[14px] font-medium text-foreground">{application.user_name || 'Unknown'}</p>
                {application.user_email && (
                  <p className="text-[12px] text-muted-foreground">{application.user_email}</p>
                )}
              </div>
            </div>
            {client && (
              <div className="space-y-2 text-[13px]">
                {client.phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="text-foreground">{client.phone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">KYC</span>
                  <Badge value={client.kyc_status} />
                </div>
              </div>
            )}
          </GlassCard>

          {/* Status Timeline */}
          <GlassCard>
            <h3 className="text-[15px] font-semibold text-foreground mb-4">Status</h3>
            <StatusTimeline currentStatus={application.status} />
          </GlassCard>

          {/* Assigned Brokers */}
          {application.assigned_brokers.length > 0 && (
            <GlassCard>
              <h3 className="text-[15px] font-semibold text-foreground mb-3">Assigned Brokers</h3>
              <div className="space-y-2">
                {application.assigned_brokers.map((b) => (
                  <div key={b.id} className="flex items-center gap-2.5 rounded-lg bg-secondary/50 px-3 py-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-chart-2/10">
                      <span className="text-[10px] font-semibold text-chart-2">{getInitials(b.full_name)}</span>
                    </div>
                    <span className="text-[13px] font-medium text-foreground">{b.full_name}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
