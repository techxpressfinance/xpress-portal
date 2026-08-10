import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Badge, Button } from '../ui';
import { getErrorMessage } from '../../lib/utils';
import {
  ARREARS_ACCEPT,
  EVENT_LABELS,
  bucketClass,
  bucketLabel,
  fileTypeLabel,
  formatMoney,
  formatRepayment,
  formatStamp,
} from '../../lib/arrears';
import type { ArrearsAttachment, ArrearsRecord, ArrearsRecordDetail } from '../../types';
import FileDropzone from '../FileDropzone';

/** Emails carry their own header block; everything else is a plain file row. */
function AttachmentRow({
  attachment,
  recordId,
  onDelete,
}: {
  attachment: ArrearsAttachment;
  recordId: string;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const download = async () => {
    const { data } = await api.get(`/arrears/${recordId}/attachments/${attachment.id}/download`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.original_filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {attachment.kind === 'email' ? (
            <>
              <p className="truncate text-[13px] font-medium text-foreground">
                {attachment.email_subject || attachment.original_filename}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {attachment.email_from || 'Unknown sender'}
                {attachment.email_sent_at ? ` · ${formatStamp(attachment.email_sent_at)}` : ''}
              </p>
            </>
          ) : (
            <p className="truncate text-[13px] font-medium text-foreground">{attachment.original_filename}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {attachment.kind === 'screenshot' ? 'Snip' : attachment.kind === 'email' ? 'Email' : 'File'}
            {' · added '}
            {formatStamp(attachment.uploaded_at)}
            {attachment.uploaded_by_name ? ` by ${attachment.uploaded_by_name}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {attachment.kind === 'email' && attachment.email_body && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              {expanded ? 'Hide' : 'Read'}
            </button>
          )}
          <button type="button" onClick={download} className="text-[12px] font-medium text-primary hover:underline">
            Download
          </button>
          <button
            type="button"
            onClick={() => onDelete(attachment.id)}
            className="text-[12px] font-medium text-muted-foreground hover:text-destructive"
          >
            Remove
          </button>
        </div>
      </div>
      {expanded && attachment.email_body && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-[12px] text-foreground">
          {attachment.email_body}
        </pre>
      )}
    </div>
  );
}

export default function ArrearsDetailPanel({
  recordId,
  onClose,
  onChanged,
  onEdit,
}: {
  recordId: string;
  onClose: () => void;
  onChanged: (record: ArrearsRecord) => void;
  onEdit: (record: ArrearsRecord) => void;
}) {
  const { toast } = useToast();
  const [record, setRecord] = useState<ArrearsRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [delinquentReason, setDelinquentReason] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get<ArrearsRecordDetail>(`/arrears/${recordId}`);
      setRecord(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load arrears record'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (data: ArrearsRecordDetail) => {
    setRecord(data);
    onChanged(data);
  };

  const patch = async (payload: Record<string, unknown>) => {
    try {
      const { data } = await api.patch<ArrearsRecordDetail>(`/arrears/${recordId}`, payload);
      apply(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update record'), 'error');
    }
  };

  const confirmDelinquent = async () => {
    await patch({ delinquent: true, delinquent_reason: delinquentReason.trim() || null });
    setFlagging(false);
    setDelinquentReason('');
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post<ArrearsRecordDetail>(`/arrears/${recordId}/attachments`, body);
      apply(data);
      toast('Attached', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Upload failed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    try {
      const { data } = await api.delete<ArrearsRecordDetail>(`/arrears/${recordId}/attachments/${attachmentId}`);
      apply(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to remove attachment'), 'error');
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      const { data } = await api.post<ArrearsRecordDetail>(`/arrears/${recordId}/events`, { detail: note.trim() });
      apply(data);
      setNote('');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to add note'), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-l border-border bg-background shadow-xl">
        {loading || !record ? (
          <div className="p-6 text-[14px] text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-semibold text-foreground">
                    {record.organization_name || record.contact_name || 'Arrears record'}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {record.lender_name}
                    {record.contract_number ? ` · ${record.contract_number}` : ''}
                  </p>
                </div>
                <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Close">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge type="custom" value={record.bucket} label={`${record.days_in_arrears} days · ${bucketLabel(record.bucket)}`} className={bucketClass(record.bucket)} />
                <Badge type="custom" value={record.file_type} label={fileTypeLabel(record.file_type)} />
                {record.resolved && <Badge type="custom" value="resolved" label="Resolved" className="led-chip-success" />}
              </div>
            </div>

            <div className="space-y-6 px-6 py-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                {[
                  ['Client', record.contact_name || '—'],
                  ['Company', record.organization_name || '—'],
                  ['Lender', record.lender_name],
                  ['Contract number', record.contract_number || '—'],
                  ['Repayment', formatRepayment(record.repayment_amount, record.repayment_frequency)],
                  ['Amount in arrears', formatMoney(record.arrears_amount)],
                  ['In arrears since', new Date(`${record.in_arrears_since}T00:00:00`).toLocaleDateString('en-AU')],
                  ['File type', fileTypeLabel(record.file_type)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-foreground">{value}</dd>
                  </div>
                ))}
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Asset details</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{record.asset_details || '—'}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={record.resolved ? 'secondary' : 'primary'}
                  onClick={() => patch({ resolved: !record.resolved })}
                >
                  {record.resolved ? 'Reopen arrears' : 'Mark resolved'}
                </Button>
                <Button
                  size="sm"
                  variant={record.proof_of_payment_received ? 'secondary' : 'primary'}
                  onClick={() => patch({ proof_of_payment_received: !record.proof_of_payment_received })}
                >
                  {record.proof_of_payment_received ? 'Clear proof of payment' : 'Proof of payment received'}
                </Button>
                <Button
                  size="sm"
                  variant={record.delinquent ? 'secondary' : 'danger'}
                  onClick={() => {
                    if (record.delinquent) { patch({ delinquent: false }); return; }
                    setFlagging(true);
                  }}
                >
                  {record.delinquent ? 'Remove delinquent flag' : 'Flag delinquent'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onEdit(record)}>Edit details</Button>
              </div>

              {record.delinquent && record.delinquent_reason && (
                <p className="text-[12px] text-muted-foreground">
                  Delinquent: {record.delinquent_reason}
                  {record.delinquent_at ? ` · flagged ${formatStamp(record.delinquent_at)}` : ''}
                </p>
              )}

              {flagging && !record.delinquent && (
                <div className="flex gap-2">
                  <input
                    className="led-input !h-9 !text-[13px]"
                    autoFocus
                    placeholder="Reason — default, legal action, repossession…"
                    value={delinquentReason}
                    onChange={(e) => setDelinquentReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmDelinquent(); }}
                  />
                  <Button size="sm" variant="danger" onClick={confirmDelinquent}>Flag</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setFlagging(false); setDelinquentReason(''); }}>
                    Cancel
                  </Button>
                </div>
              )}

              <section>
                <h4 className="mb-2 text-[13px] font-semibold text-foreground">Attachments & emails</h4>
                <FileDropzone
                  uploading={uploading}
                  onFile={upload}
                  onError={(m) => toast(m, 'error')}
                  accept={ARREARS_ACCEPT}
                  maxSizeMb={15}
                  prompt="Drop an email or file, click to browse, or paste a snip"
                  hint="Drag a message from Outlook desktop, or save it from Gmail/Outlook Web and drop the .eml — PDF, JPG, PNG also accepted"
                />
                <div className="mt-3 space-y-2">
                  {record.attachments.length === 0 && (
                    <p className="text-[13px] text-muted-foreground">Nothing attached yet.</p>
                  )}
                  {record.attachments.map((a) => (
                    <AttachmentRow key={a.id} attachment={a} recordId={record.id} onDelete={removeAttachment} />
                  ))}
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-[13px] font-semibold text-foreground">History</h4>
                <div className="flex gap-2">
                  <input
                    className="led-input !h-9 !text-[13px]"
                    placeholder="Add a note to the timeline…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                  />
                  <Button size="sm" onClick={addNote} loading={savingNote} disabled={!note.trim()}>Add</Button>
                </div>
                <ol className="mt-3 space-y-3">
                  {record.events.map((e) => (
                    <li key={e.id} className="border-l-2 border-border pl-3">
                      <p className="text-[13px] text-foreground">{e.detail || EVENT_LABELS[e.event_type] || e.event_type}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatStamp(e.created_at)}
                        {e.created_by_name ? ` · ${e.created_by_name}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
