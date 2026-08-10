import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, GlassCard } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import { formatMoney } from '../../lib/arrears';
import type { ArrearsRecord } from '../../types';
import ArrearsDetailPanel from './ArrearsDetailPanel';
import ArrearsRecordModal from './ArrearsRecordModal';
import ArrearsTable from './ArrearsTable';

/**
 * The arrears book filtered to one client or company, embedded on their detail
 * page. New records created here come pre-linked to that party.
 */
export default function ArrearsSection({
  contact,
  organization,
}: {
  contact?: { id: string; name: string };
  organization?: { id: string; name: string };
}) {
  const { toast } = useToast();
  const [records, setRecords] = useState<ArrearsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArrearsRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ items: ArrearsRecord[] }>('/arrears', {
        params: {
          contact_id: contact?.id,
          organization_id: organization?.id,
          per_page: 100,
        },
      });
      setRecords(data.items);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load arrears'), 'error');
    } finally {
      setLoading(false);
    }
  }, [contact?.id, organization?.id, toast]);

  useEffect(() => { load(); }, [load]);

  const open = records.filter((r) => !r.resolved);
  const outstanding = open.reduce((sum, r) => sum + Number(r.arrears_amount || 0), 0);

  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">Arrears</h3>
          <p className="text-[12px] text-muted-foreground">
            {loading
              ? 'Loading…'
              : records.length === 0
                ? 'No contracts in the arrears book.'
                : `${open.length} of ${records.length} contract${records.length === 1 ? '' : 's'} unresolved · ${formatMoney(outstanding)} outstanding`}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>Add contract</Button>
      </div>

      {!loading && (
        <ArrearsTable
          records={records}
          onSelect={(r) => setSelectedId(r.id)}
          emptyMessage="No arrears recorded against this party."
        />
      )}

      {selectedId && (
        <ArrearsDetailPanel
          recordId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => load()}
          onEdit={(r) => { setSelectedId(null); setEditing(r); }}
        />
      )}

      {(creating || editing) && (
        <ArrearsRecordModal
          record={editing}
          fixedContact={contact ?? null}
          fixedOrganization={organization ?? null}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </GlassCard>
  );
}
