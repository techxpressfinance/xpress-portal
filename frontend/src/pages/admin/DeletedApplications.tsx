import { useEffect, useState, type ReactNode } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { relativeTime, fmtMoneyK } from '../../lib/utils';
import { STATUS_LABEL } from '../../lib/constants';
import type { LoanApplication } from '../../types';

function Icon({ name, size = 14, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
    refresh: <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />,
    loader: <><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
    car: <path d="M3 13h18l-2-6H5l-2 6Zm0 0v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2m10 0v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-4M7 16h.01M17 16h.01" />,
    home: <path d="M3 12 12 4l9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] || null}
    </svg>
  );
}

const LOAN_TYPE_ICON: Record<string, string> = { business: 'briefcase', vehicle: 'car', home: 'home', personal: 'user' };
const LOAN_TYPE_LABEL: Record<string, string> = { business: 'Business', vehicle: 'Vehicle', home: 'Home', personal: 'Personal' };

export default function DeletedApplications() {
  const [apps, setApps] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/applications/deleted');
      setApps(data);
    } catch {
      toast('Failed to load deleted applications', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRestore = async (appId: string) => {
    setRestoring(appId);
    try {
      await api.post(`/applications/${appId}/restore`);
      toast('Application restored', 'success');
      setApps(prev => prev.filter(a => a.id !== appId));
    } catch {
      toast('Failed to restore application', 'error');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-red-50 text-red-600">
          <Icon name="trash" size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Deleted Applications</h1>
          <p className="text-sm text-gray-500">Soft-deleted applications. Restore to make them active again.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Icon name="loader" size={24} className="animate-spin mr-2" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <Icon name="trash" size={40} className="opacity-30" />
          <p className="text-sm">No deleted applications</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Applicant</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status at deletion</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Deleted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apps.map(app => (
                <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {[app.applicant_first_name, app.applicant_last_name].filter(Boolean).join(' ') || app.user_name || '—'}
                    </div>
                    {app.user_email && (
                      <div className="text-xs text-gray-400">{app.user_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Icon name={LOAN_TYPE_ICON[app.loan_type] || 'briefcase'} size={13} />
                      <span>{LOAN_TYPE_LABEL[app.loan_type] || app.loan_type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {fmtMoneyK(Number(app.amount) || 0)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {STATUS_LABEL[app.status] || app.status}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {app.deleted_at ? relativeTime(app.deleted_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRestore(app.id)}
                      disabled={restoring === app.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
                    >
                      {restoring === app.id ? (
                        <Icon name="loader" size={12} className="animate-spin" />
                      ) : (
                        <Icon name="refresh" size={12} />
                      )}
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
