import { useEffect, useState } from 'react';
import api from '../api/client';
import { Card } from './ui';
import { durationSince, formatDate, getErrorMessage } from '../lib/utils';
import type { AbnHistory as History, AbnHistoryResponse, AbrPeriod } from '../types';

const span = (p: AbrPeriod) => `${p.from ? formatDate(p.from) : '?'} – ${p.to ? formatDate(p.to) : 'present'}`;

function Period<T extends AbrPeriod>({ title, rows, label, initial = 6, empty }: {
  title: string;
  rows: T[];
  label: (row: T) => React.ReactNode;
  initial?: number;
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, initial);
  return (
    <div>
      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{empty ?? 'None on the register.'}</p>
      ) : (
        <ol className="space-y-1.5">
          {shown.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className={r.to ? 'text-muted-foreground' : 'font-medium text-foreground'}>{label(r)}</span>
              <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">{span(r)}</span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > initial && (
        <button type="button" className="mt-1.5 text-[12px] font-medium text-primary hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** What a lender asks first: how long the ABN has been held, whether it has
 *  been cancelled since, and the GST position. */
function summary(h: History): { text: string; tone: 'ok' | 'warn' }[] {
  const out: { text: string; tone: 'ok' | 'warn' }[] = [];
  const current = h.status_history.find((s) => !s.to);
  const cancelled = h.status_history.filter((s) => s.status && s.status.toLowerCase() !== 'active');
  if (h.first_registered) {
    out.push({ text: `First registered ${formatDate(h.first_registered)} (${durationSince(h.first_registered) ?? 'recent'})`, tone: 'ok' });
  }
  if (current && current.status?.toLowerCase() === 'active' && cancelled.length && current.from) {
    out.push({ text: `Active again since ${formatDate(current.from)} (${durationSince(current.from) ?? 'recent'}) — cancelled ${cancelled.length === 1 ? 'once' : `${cancelled.length} times`} before`, tone: 'warn' });
  } else if (current && current.status?.toLowerCase() !== 'active') {
    out.push({ text: `${current.status ?? 'Not active'} since ${current.from ? formatDate(current.from) : '?'}`, tone: 'warn' });
  } else if (current) {
    out.push({ text: 'Active without a break', tone: 'ok' });
  }
  const gstNow = h.gst_history.find((g) => !g.to);
  if (gstNow?.from) {
    out.push({ text: `GST registered since ${formatDate(gstNow.from)}${h.gst_history.length > 1 ? ' (registered before, with a gap)' : ''}`, tone: h.gst_history.length > 1 ? 'warn' : 'ok' });
  } else {
    out.push({ text: h.gst_history.length ? `Not registered for GST now — last registered until ${formatDate(h.gst_history[0].to)}` : 'Never registered for GST', tone: 'warn' });
  }
  return out;
}

/** The register's history of an entity's ABN: when it was registered, any
 *  cancelled periods, GST periods, name changes, trading and business names,
 *  and moves between states. Fetched from ABR on first view and kept on the
 *  entity; bump ``refreshKey`` after re-reading the register. */
export default function AbnHistory({ organizationId, abn, refreshKey = 0 }: { organizationId: string; abn: string | null; refreshKey?: number }) {
  const [data, setData] = useState<AbnHistoryResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abn) return;
    let cancelled = false;
    api.get<AbnHistoryResponse>(`/organizations/${organizationId}/abn-history`)
      .then(({ data }) => { if (!cancelled) { setData(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err, 'Could not load the ABN history')); });
    return () => { cancelled = true; };
  }, [organizationId, abn, refreshKey]);

  if (!abn || data?.state === 'no_abn') return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await api.get<AbnHistoryResponse>(`/organizations/${organizationId}/abn-history`, { params: { refresh: true } });
      setData(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not reach the register'));
    } finally {
      setRefreshing(false);
    }
  };

  const h = data?.history ?? null;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">ABN history</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            From the Australian Business Register
            {data?.checked_at ? ` · checked ${formatDate(data.checked_at)}` : ''}
            {h?.record_last_updated ? ` · record last changed ${formatDate(h.record_last_updated)}` : ''}
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} className="text-[12px] font-medium text-primary hover:underline disabled:opacity-50">
          {refreshing ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {!data && !error && <p className="text-[13px] text-muted-foreground">Loading the register&rsquo;s history…</p>}
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      {data?.state === 'not_on_register' && <p className="text-[13px] text-muted-foreground">This ABN isn&rsquo;t on the register.</p>}
      {data?.state === 'unavailable' && (
        <p className="mb-3 text-[13px] text-muted-foreground">
          {data.message || 'ABN Lookup could not be reached.'}{h ? ' Showing the history kept from the last check.' : ''}
        </p>
      )}

      {h && (
        <>
          <ul className="mb-5 flex flex-wrap gap-2">
            {summary(h).map((s) => (
              <li key={s.text} className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${s.tone === 'ok' ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
                {s.text}
              </li>
            ))}
          </ul>
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Period title="ABN status" rows={h.status_history} label={(r) => r.status ?? '—'} />
            <Period title="GST registration" rows={h.gst_history} label={() => 'Registered'} empty="Never registered for GST." />
            <Period title={h.entity_type?.toLowerCase().includes('individual') ? 'Legal name' : 'Entity name'} rows={h.name_history} label={(r) => r.name} />
            <Period title="Registered location" rows={h.address_history} label={(r) => [r.state, r.postcode].filter(Boolean).join(' ') || '—'} />
            {h.business_names.length > 0 && <Period title="Business names" rows={h.business_names} label={(r) => r.name} />}
            {h.trading_names.length > 0 && <Period title="Trading names (pre-2012 register)" rows={h.trading_names} label={(r) => r.name} />}
          </div>
        </>
      )}
    </Card>
  );
}
