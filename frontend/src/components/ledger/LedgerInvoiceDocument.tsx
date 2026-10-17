import { useState } from 'react';
import api from '../../api/client';
import { useToast } from '../Toast';
import { Button } from '../ui';
import { downloadElementPdf } from '../../lib/pdfExport';
import { A4_PRINT_WIDTH_PX } from '../../lib/printPage';
import { formatDate, getErrorMessage } from '../../lib/utils';
import { formatLedgerMoney, PAYMENT_METHODS } from '../../lib/ledger';
import type { LedgerInvoice } from '../../types';
import LedgerModal from './LedgerModal';

const cell = { padding: '6px 8px', borderBottom: '1px solid #E2E5EA', color: '#111', verticalAlign: 'top' as const };
const right = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

/** A referrer's commission invoice: the referrer supplies, we are billed.
 *  "breakdown" lists each settled deal; "single" prints one overall figure.
 *  A plain layout until the desk's own invoice format replaces it. */
export function LedgerInvoiceDocument({ invoice, elementId }: { invoice: LedgerInvoice; elementId: string }) {
  const s = invoice.supplier;
  const r = invoice.recipient;
  const breakdown = invoice.layout === 'breakdown';
  const hasBank = Boolean(s.bank_bsb || s.bank_account_number);
  return (
    <div id={elementId} style={{ width: A4_PRINT_WIDTH_PX.portrait, background: '#fff', padding: 40, fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 11, color: '#111' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{s.name}</div>
          {s.contact_name && s.contact_name !== s.name && <div>{s.contact_name}</div>}
          {s.abn && <div>ABN {s.abn}</div>}
          {s.address && <div style={{ whiteSpace: 'pre-line' }}>{s.address}</div>}
          {s.email && <div>{s.email}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>{s.gst_registered ? 'TAX INVOICE' : 'INVOICE'}</div>
          <div style={{ marginTop: 6 }}>Invoice no. <b>{invoice.number}</b></div>
          <div>Date {formatDate(invoice.issue_date)}</div>
          <div>Period {invoice.period_label}</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#555', marginBottom: 4 }}>Bill to</div>
        <div style={{ fontWeight: 700 }}>{r.business_name}</div>
        {r.business_abn && <div>ABN {r.business_abn}</div>}
        {r.business_address && <div style={{ whiteSpace: 'pre-line' }}>{r.business_address}</div>}
        {r.business_email && <div>{r.business_email}</div>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ background: '#F1F3F7' }}>
            {breakdown ? (
              <>
                <th style={{ ...cell, textAlign: 'left' }}>Settled</th>
                <th style={{ ...cell, textAlign: 'left' }}>Client</th>
                <th style={{ ...cell, textAlign: 'left' }}>Lender</th>
                <th style={right}>Finance amount</th>
              </>
            ) : (
              <th style={{ ...cell, textAlign: 'left' }}>Description</th>
            )}
            <th style={right}>Amount ex GST</th>
            <th style={right}>GST</th>
            <th style={right}>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={line.application_id ?? i}>
              {breakdown ? (
                <>
                  <td style={cell}>{line.settled_on ? formatDate(line.settled_on) : ''}</td>
                  <td style={cell}>
                    {line.customer_name}
                    {line.entity_name && line.entity_name !== line.customer_name && <div style={{ color: '#555' }}>{line.entity_name}</div>}
                  </td>
                  <td style={cell}>{line.lender_name || '—'}</td>
                  <td style={right}>{formatLedgerMoney(line.finance_amount)}</td>
                </>
              ) : (
                <td style={cell}>{line.description}</td>
              )}
              <td style={right}>{formatLedgerMoney(line.amount_ex_gst)}</td>
              <td style={right}>{formatLedgerMoney(line.gst)}</td>
              <td style={right}>{formatLedgerMoney(line.amount_inc_gst)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ marginLeft: 'auto', borderCollapse: 'collapse', minWidth: 260 }}>
        <tbody>
          <tr><td style={cell}>Subtotal (ex GST)</td><td style={right}>{formatLedgerMoney(invoice.total_ex_gst)}</td></tr>
          <tr><td style={cell}>GST</td><td style={right}>{formatLedgerMoney(invoice.total_gst)}</td></tr>
          <tr><td style={{ ...cell, fontWeight: 700 }}>Total payable</td><td style={{ ...right, fontWeight: 700 }}>{formatLedgerMoney(invoice.total_inc_gst)}</td></tr>
        </tbody>
      </table>

      {breakdown && <div style={{ marginTop: 8, color: '#555' }}>{invoice.deal_count} settled deal{invoice.deal_count === 1 ? '' : 's'}.</div>}

      {hasBank && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#555', marginBottom: 4 }}>Payment to</div>
          {s.bank_account_name && <div>Account name {s.bank_account_name}</div>}
          {s.bank_bsb && <div>BSB {s.bank_bsb}</div>}
          {s.bank_account_number && <div>Account {s.bank_account_number}</div>}
        </div>
      )}
    </div>
  );
}

/** An issued invoice on screen, with its download and — for the owner — a
 *  one-step "mark these deals paid". */
export default function LedgerInvoiceModal({ invoice, isOwner, onClose, onPaid }: {
  invoice: LedgerInvoice;
  isOwner: boolean;
  onClose: () => void;
  onPaid?: () => void;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('Bank transfer');
  const [marking, setMarking] = useState(false);
  const elementId = `ledger-invoice-${invoice.id}`;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadElementPdf(elementId, `${invoice.number} ${invoice.supplier.name}.pdf`);
    } catch (err) {
      toast(getErrorMessage(err, 'PDF failed'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const markPaid = async () => {
    setMarking(true);
    try {
      const ids = invoice.application_ids;
      await api.post('/ledger/deals/mark-paid', {
        application_ids: ids,
        paid_on: paidOn,
        payment_method: method,
        payment_notes: `Invoice ${invoice.number}`,
      });
      toast(`${ids.length} deal${ids.length === 1 ? '' : 's'} marked paid`, 'success');
      onPaid?.();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to mark paid'), 'error');
    } finally {
      setMarking(false);
    }
  };

  return (
    <LedgerModal
      title={`Invoice ${invoice.number}`}
      subtitle={`${invoice.supplier.name} · ${formatLedgerMoney(invoice.total_inc_gst)}`}
      onClose={onClose}
      wide
      footer={
        <>
          {isOwner && (
            <div className="mr-auto flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-muted-foreground">Paid on</span>
              <input type="date" className="led-input !h-8 !w-auto text-[12.5px]" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              <select className="led-input !h-8 !w-auto text-[12.5px]" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <Button size="sm" variant="secondary" onClick={markPaid} loading={marking}>Mark deals paid</Button>
            </div>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={download} loading={downloading}>Download PDF</Button>
        </>
      }
    >
      <div className="overflow-x-auto rounded border border-border bg-white">
        <LedgerInvoiceDocument invoice={invoice} elementId={`${elementId}-preview`} />
      </div>
      {/* The PDF is drawn from an unscaled, off-screen copy. */}
      <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
        <LedgerInvoiceDocument invoice={invoice} elementId={elementId} />
      </div>
    </LedgerModal>
  );
}
