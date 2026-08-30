import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button, Card } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import { downloadElementPdf } from '../../lib/pdfExport';
import { downloadArrearsCsv, formatMoney } from '../../lib/arrears';
import type { ArrearsRecord, ArrearsRecordDetail } from '../../types';
import ArrearsDetailPanel from './ArrearsDetailPanel';
import ArrearsRecordModal from './ArrearsRecordModal';
import ArrearsRecordPrint from './ArrearsRecordPrint';
import { loadArrearsPrintImages, type ArrearsPrintImages } from './printImages';
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
  const [downloading, setDownloading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printRecords, setPrintRecords] = useState<ArrearsRecordDetail[]>([]);
  const [printImages, setPrintImages] = useState<ArrearsPrintImages>({});

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

  /** One-click CSV of everything in this party's book — the "download the
   *  arrears records for this client" action, right where the book lives.
   *  Pulled from /arrears/report, which is unpaginated: a page size would
   *  silently truncate the export for a party with a long book. */
  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get<ArrearsRecord[]>('/arrears/report', {
        params: {
          contact_id: contact?.id,
          organization_id: organization?.id,
        },
      });
      if (data.length === 0) {
        toast('No arrears recorded against this party', 'error');
        return;
      }
      downloadArrearsCsv(data, `arrears-${(contact?.name ?? organization?.name ?? 'party').replace(/[^\w-]+/g, '_')}`);
    } catch (err) {
      toast(getErrorMessage(err, 'Download failed'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const open = records.filter((r) => !r.resolved);
  const outstanding = open.reduce((sum, r) => sum + Number(r.arrears_amount || 0), 0);

  /** Full-detail PDF for every contract in this party's book — each record's
   *  facts plus its contact attempts and history. The report endpoint returns
   *  summaries, so fetch each record's detail (unpaginated, same as the CSV). */
  const downloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const { data } = await api.get<ArrearsRecord[]>('/arrears/report', {
        params: { contact_id: contact?.id, organization_id: organization?.id },
      });
      if (data.length === 0) {
        toast('No arrears recorded against this party', 'error');
        return;
      }
      const details = await Promise.all(
        data.map((r) => api.get<ArrearsRecordDetail>(`/arrears/${r.id}`).then((res) => res.data)),
      );
      setPrintRecords(details);
      // Screenshots sit behind an authenticated endpoint, so they have to be
      // inlined as data URLs before html2canvas can paint them.
      setPrintImages(await loadArrearsPrintImages(details));
      // Let React paint the off-screen print block before html2pdf reads it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const name = (contact?.name ?? organization?.name ?? 'party').replace(/[^\w-]+/g, '_');
      await downloadElementPdf('arrears-client-print', `arrears-${name}.pdf`, 'portrait');
    } catch (err) {
      toast(getErrorMessage(err, 'PDF export failed'), 'error');
    } finally {
      setPrintRecords([]);
      setPrintImages({});
      setDownloadingPdf(false);
    }
  };

  return (
    <Card className="p-4">
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
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={downloadCsv} loading={downloading} disabled={loading}>
            Download CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={downloadPdf} loading={downloadingPdf} disabled={loading}>
            Download PDF
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>Add contract</Button>
        </div>
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

      {/* Off-screen print source for the party-level PDF. */}
      {printRecords.length > 0 && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
          <div id="arrears-client-print">
            <ArrearsRecordPrint
              records={printRecords}
              images={printImages}
              subject={contact?.name ?? organization?.name}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
