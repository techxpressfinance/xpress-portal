import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { Card, Badge, Button, LoanTypeIcon } from '../../components/ui';
import { formatDate } from '../../lib/utils';
import type { ApplicationStatus, LoanApplication } from '../../types';
import { ChevronRightIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

const STATUS_ACCENT: Record<ApplicationStatus, string> = {
  draft: 'bg-[var(--led-muted)]',
  application_received: 'bg-[var(--led-accent)]',
  application_assessed: 'bg-purple-500',
  submitted: 'bg-blue-500',
  approval: 'bg-amber-500',
  settled: 'bg-[var(--led-success)]',
  rejected: 'bg-red-500',
  not_proceeding: 'bg-[var(--led-muted)]',
};

const PIPELINE: ApplicationStatus[] = [
  'application_received',
  'application_assessed',
  'submitted',
  'approval',
  'settled',
];

function PipelineBar({ status }: { status: ApplicationStatus }) {
  if (status === 'rejected' || status === 'not_proceeding' || status === 'draft') return null;
  const idx = PIPELINE.indexOf(status);
  return (
    <div className="flex items-center gap-1 mt-2">
      {PIPELINE.map((s, i) => (
        <div
          key={s}
          className={`h-1 flex-1 rounded-full transition-colors ${i <= idx ? STATUS_ACCENT[status] : 'bg-[var(--led-line)]'}`}
        />
      ))}
    </div>
  );
}

export default function Applications() {
  const { toast } = useToast();
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/applications')
      .then(({ data }) => setApplications(data.items))
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const active = applications.filter((a) => !['settled', 'rejected', 'not_proceeding', 'draft'].includes(a.status));
  const rest = applications.filter((a) => ['settled', 'rejected', 'not_proceeding', 'draft'].includes(a.status));
  const ordered = [...active, ...rest];

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Client</span>
            {!loading && applications.length > 0 && (
              <span className="led-chip">{applications.length} application{applications.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div>
            <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">My Applications</h1>
            <p className="mt-2 text-[14px] leading-6 text-[var(--led-muted)]">Track and manage all your loan applications</p>
          </div>
        </div>
        <Link to="/applications/new">
          <Button size="lg" className="h-11 px-5">+ New Application</Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-[var(--led-line)] bg-[var(--led-surface)] p-5">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl shimmer shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-36 rounded shimmer" />
                  <div className="h-3 w-24 rounded shimmer" />
                  <div className="h-1.5 w-full rounded-full shimmer mt-3" />
                </div>
                <div className="h-6 w-24 rounded-full shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : applications.length === 0 ? (
        <Card padding="none" className="text-center">
          <div className="px-6 py-16">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
              <DocumentTextIcon className="h-10 w-10 text-[var(--led-muted)]" />
            </div>
            <h3 className="text-[15px] font-semibold text-[var(--led-ink)] mb-1">No applications yet</h3>
            <p className="text-[14px] text-[var(--led-muted)] mb-5">Get started by creating your first loan application</p>
            <Link to="/applications/new">
              <Button>Create Application</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {ordered.map((app) => (
            <Link
              key={app.id}
              to={`/applications/${app.id}`}
              className="group flex items-start gap-4 rounded-2xl border border-[var(--led-line)] bg-[var(--led-surface)] p-5 transition-all duration-200 hover:border-[var(--led-accent)]/30 hover:bg-[var(--led-surface-2)] hover:shadow-sm"
            >
              {/* Status accent bar */}
              <div className={`mt-0.5 h-12 w-1 shrink-0 rounded-full ${STATUS_ACCENT[app.status]}`} />

              {/* Loan type icon */}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--led-surface-2)] text-[var(--led-muted)]">
                <LoanTypeIcon type={app.loan_type} className="h-6 w-6" />
              </div>

              {/* Main content */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-semibold text-[var(--led-ink)] capitalize leading-tight">
                      {app.loan_type.replace(/_/g, ' ')} Loan
                    </p>
                    <p className="mt-0.5 text-[13px] text-[var(--led-muted)]">
                      <span className="font-medium text-[var(--led-ink)]">${Number(app.amount).toLocaleString('en-AU')}</span>
                      {' · '}Applied {formatDate(app.created_at)}
                      {app.updated_at !== app.created_at && (
                        <> · Updated {formatDate(app.updated_at)}</>
                      )}
                    </p>
                    {app.assigned_broker_name && (
                      <p className="mt-1 text-[12px] text-[var(--led-muted)]">
                        Broker: <span className="font-medium text-[var(--led-ink-2)]">{app.assigned_broker_name}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge value={app.status} />
                    <ChevronRightIcon className="h-4 w-4 text-[var(--led-muted)] transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                  </div>
                </div>
                <PipelineBar status={app.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
