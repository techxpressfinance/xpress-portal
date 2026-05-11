import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader } from '../../components/ui';

interface ReferrerClient {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  source: 'direct' | 'referred';
}

export default function ReferrerClients() {
  const { toast } = useToast();
  const [clients, setClients] = useState<ReferrerClient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/referrer/clients')
      .then(({ data }) => setClients(data))
      .catch(() => toast('Failed to load clients', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="My Clients"
        subtitle="Clients you've referred or submitted leads for"
      />
      <GlassCard padding="none">
        {loading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg shimmer" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-36 rounded-lg shimmer" />
                  <div className="h-3 w-52 rounded-lg shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-foreground mb-1">No clients yet</p>
            <p className="text-[13px] text-muted-foreground">Add a lead to get started — your clients will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Client</th>
                  <th className="hidden sm:table-cell px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Mobile</th>
                  <th className="px-6 py-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map(c => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <tr key={c.id} className="hover:bg-secondary/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                            <span className="text-[11px] font-semibold text-muted-foreground">{initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-foreground">{name}</p>
                            {c.email && <p className="text-[12px] text-muted-foreground truncate">{c.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4 text-[14px] text-muted-foreground">{c.mobile || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${
                          c.source === 'direct'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-secondary text-muted-foreground'
                        }`}>
                          {c.source === 'direct' ? 'Direct lead' : 'Referred'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
