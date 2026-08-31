import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { Card, Badge, Button } from './ui';
import { getErrorMessage, formatDate } from '../lib/utils';
import { downloadElementPdf } from '../lib/pdfExport';
import { A4_PRINT_WIDTH_PX } from '../lib/printPage';
import type { SupplierType, TaxInvoice } from '../types';

/**
 * Tax invoices for the asset being financed.
 *
 * Three supplier kinds need three slightly different documents — a GST-registered
 * dealer, a private seller (usually charging no GST), and an auction house
 * (which adds a buyer's premium). The field set follows the ATO's tax-invoice
 * requirements; anything specific to this desk's paperwork is still to come.
 *
 * Totals are never computed here — the server derives them, so the printed
 * document can't disagree with the record.
 */

const SUPPLIER_LABEL: Record<SupplierType, string> = {
  dealer: 'Dealer',
  private: 'Private seller',
  auction: 'Auction house',
};

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The fields the form edits — everything on the invoice except the
 *  server-derived `totals`/`missing` and the read-only audit stamps. */
type EditableField = {
  [K in keyof TaxInvoice]: TaxInvoice[K] extends string | number | boolean | null ? K : never
}[keyof TaxInvoice];

type Draft = Partial<Record<EditableField, string | number | boolean | null>>;

export default function TaxInvoicePanel({ applicationId }: { applicationId: string }) {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/applications/${applicationId}/tax-invoices`);
      setInvoices(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to load tax invoices'), 'error');
    } finally {
      setLoading(false);
    }
  }, [applicationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The panel only mounts when its tab is opened, so this is already lazy.
  useEffect(() => { load(); }, [load]);

  const create = async (supplierType: SupplierType) => {
    try {
      const { data } = await api.post(`/applications/${applicationId}/tax-invoices`, { supplier_type: supplierType });
      await load();
      setOpenId(data.id);
      setDraft({});
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to start the invoice'), 'error');
    }
  };

  const save = async (invoice: TaxInvoice) => {
    if (!Object.keys(draft).length) return;
    setSaving(true);
    try {
      await api.patch(`/applications/${applicationId}/tax-invoices/${invoice.id}`, draft);
      setDraft({});
      await load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const issue = async (invoice: TaxInvoice) => {
    try {
      await api.post(`/applications/${applicationId}/tax-invoices/${invoice.id}/issue`);
      await load();
      toast('Invoice issued', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to issue'), 'error');
    }
  };

  const remove = async (invoice: TaxInvoice) => {
    try {
      await api.delete(`/applications/${applicationId}/tax-invoices/${invoice.id}`);
      if (openId === invoice.id) setOpenId(null);
      await load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to delete'), 'error');
    }
  };

  const field = (invoice: TaxInvoice, key: EditableField): string | number | boolean =>
    (draft[key] !== undefined ? draft[key] : invoice[key]) ?? '';

  const set = (key: EditableField, value: string | number | boolean | null) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <Card>
        <div className="h-5 w-32 rounded shimmer mb-4" />
        <div className="h-16 rounded-lg shimmer" />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[15px] font-semibold text-foreground">Tax Invoices</h2>
        <div className="flex gap-1.5">
          {(Object.keys(SUPPLIER_LABEL) as SupplierType[]).map((t) => (
            <Button key={t} type="button" variant="secondary" onClick={() => create(t)}>
              + {SUPPLIER_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>

      {invoices.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No invoice yet. Start one for the dealer, private seller or auction house the asset is bought from.
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((invoice) => {
            const open = openId === invoice.id;
            const locked = invoice.status === 'issued';
            return (
              <div key={invoice.id} className="rounded-lg border border-[var(--led-line)]">
                <button
                  type="button"
                  onClick={() => { setOpenId(open ? null : invoice.id); setDraft({}); }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <Badge
                    type="custom"
                    value={invoice.status}
                    label={locked ? 'Issued' : 'Draft'}
                    className={locked ? 'led-chip-success' : ''}
                  />
                  <span className="text-[13.5px] font-medium text-foreground">
                    {SUPPLIER_LABEL[invoice.supplier_type]}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {invoice.supplier_name || 'Unnamed supplier'}
                    {invoice.invoice_number ? ` · ${invoice.invoice_number}` : ''}
                  </span>
                  <span className="ml-auto text-[13px] tabular-nums text-foreground">
                    {money(invoice.totals.total)}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-[var(--led-line)] px-3 py-3 space-y-4">
                    {!invoice.totals.is_tax_invoice && (
                      <p className="rounded-md bg-secondary px-2.5 py-2 text-[12px] text-muted-foreground">
                        This supplier is not registered for GST, so the document is issued as an
                        invoice rather than a <em>tax</em> invoice and shows no GST.
                      </p>
                    )}

                    <Section title="Invoice">
                      <Text label="Invoice number" value={field(invoice, 'invoice_number')} onChange={(v) => set('invoice_number', v)} disabled={locked} />
                      <Text label="Invoice date" type="date" value={field(invoice, 'invoice_date')} onChange={(v) => set('invoice_date', v)} disabled={locked} />
                    </Section>

                    <Section title="Supplier">
                      <Text label="Name" value={field(invoice, 'supplier_name')} onChange={(v) => set('supplier_name', v)} disabled={locked} />
                      <Text label="ABN" value={field(invoice, 'supplier_abn')} onChange={(v) => set('supplier_abn', v)} disabled={locked} />
                      <Text label="Address" value={field(invoice, 'supplier_address')} onChange={(v) => set('supplier_address', v)} disabled={locked} />
                      <Text label="Email" value={field(invoice, 'supplier_email')} onChange={(v) => set('supplier_email', v)} disabled={locked} />
                      <Text label="Phone" value={field(invoice, 'supplier_phone')} onChange={(v) => set('supplier_phone', v)} disabled={locked} />
                      <Check
                        label="Registered for GST"
                        checked={Boolean(draft.supplier_gst_registered ?? invoice.supplier_gst_registered)}
                        onChange={(v) => set('supplier_gst_registered', v)}
                        disabled={locked}
                      />
                      {invoice.supplier_type === 'private' && (
                        <Check
                          label="No ABN — 'statement by a supplier' held on file"
                          checked={Boolean(draft.abn_withholding_declared ?? invoice.abn_withholding_declared)}
                          onChange={(v) => set('abn_withholding_declared', v)}
                          disabled={locked}
                        />
                      )}
                    </Section>

                    <Section title={`Buyer${invoice.totals.buyer_identity_required ? ' (required at $1,000 or more)' : ''}`}>
                      <Text label="Name" value={field(invoice, 'buyer_name')} onChange={(v) => set('buyer_name', v)} disabled={locked} />
                      <Text label="ABN" value={field(invoice, 'buyer_abn')} onChange={(v) => set('buyer_abn', v)} disabled={locked} />
                      <Text label="Address" value={field(invoice, 'buyer_address')} onChange={(v) => set('buyer_address', v)} disabled={locked} />
                    </Section>

                    <Section title="Asset">
                      <Text label="Description" value={field(invoice, 'asset_description')} onChange={(v) => set('asset_description', v)} disabled={locked} />
                      <Text label="Make" value={field(invoice, 'asset_make')} onChange={(v) => set('asset_make', v)} disabled={locked} />
                      <Text label="Model" value={field(invoice, 'asset_model')} onChange={(v) => set('asset_model', v)} disabled={locked} />
                      <Text label="Year" value={field(invoice, 'asset_year')} onChange={(v) => set('asset_year', v)} disabled={locked} />
                      <Text label="VIN / serial" value={field(invoice, 'asset_vin')} onChange={(v) => set('asset_vin', v)} disabled={locked} />
                      <Text label="Registration" value={field(invoice, 'asset_registration')} onChange={(v) => set('asset_registration', v)} disabled={locked} />
                      <Text label="Odometer" type="number" value={field(invoice, 'asset_odometer')} onChange={(v) => set('asset_odometer', v === '' ? null : Number(v))} disabled={locked} />
                    </Section>

                    <Section title="Amounts">
                      <Text label="Sale price" type="number" value={field(invoice, 'sale_price')} onChange={(v) => set('sale_price', v === '' ? null : Number(v))} disabled={locked} />
                      {invoice.supplier_type === 'auction' && (
                        <Text label="Buyer's premium" type="number" value={field(invoice, 'buyers_premium')} onChange={(v) => set('buyers_premium', v === '' ? null : Number(v))} disabled={locked} />
                      )}
                      <Text label="Other charges" type="number" value={field(invoice, 'other_charges')} onChange={(v) => set('other_charges', v === '' ? null : Number(v))} disabled={locked} />
                      <Text label="Other charges — label" value={field(invoice, 'other_charges_label')} onChange={(v) => set('other_charges_label', v)} disabled={locked} />
                      <Text label="Deposit paid" type="number" value={field(invoice, 'deposit_paid')} onChange={(v) => set('deposit_paid', v === '' ? null : Number(v))} disabled={locked} />
                    </Section>

                    <Section title="Pay the supplier">
                      <Text label="Account name" value={field(invoice, 'payout_account_name')} onChange={(v) => set('payout_account_name', v)} disabled={locked} />
                      <Text label="BSB" value={field(invoice, 'payout_bsb')} onChange={(v) => set('payout_bsb', v)} disabled={locked} />
                      <Text label="Account number" value={field(invoice, 'payout_account_number')} onChange={(v) => set('payout_account_number', v)} disabled={locked} />
                    </Section>

                    <div className="rounded-md bg-secondary px-3 py-2 text-[12.5px] tabular-nums">
                      <Row label="Subtotal" value={money(invoice.totals.subtotal)} />
                      <Row label={invoice.totals.is_tax_invoice ? 'GST included' : 'GST'} value={money(invoice.totals.gst)} />
                      <Row label="Deposit paid" value={money(invoice.totals.deposit_paid)} />
                      <Row label="Balance due" value={money(invoice.totals.balance_due)} strong />
                    </div>

                    {invoice.missing.length > 0 && !locked && (
                      <div className="rounded-md border border-[var(--led-line)] px-3 py-2">
                        <p className="text-[12px] font-medium text-foreground mb-1">Before this can be issued</p>
                        <ul className="text-[12px] text-muted-foreground list-disc pl-4 space-y-0.5">
                          {invoice.missing.map((m) => <li key={m}>{m}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {!locked && (
                        <>
                          <Button type="button" onClick={() => save(invoice)} disabled={saving || !Object.keys(draft).length}>
                            Save
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => issue(invoice)} disabled={invoice.missing.length > 0}>
                            Issue
                          </Button>
                        </>
                      )}
                      <Button type="button" variant="secondary" onClick={() => downloadElementPdf(`tax-invoice-${invoice.id}`, `${invoice.invoice_number || 'tax-invoice'}.pdf`)}>
                        Download PDF
                      </Button>
                      {!locked && (
                        <Button type="button" variant="secondary" onClick={() => remove(invoice)}>Delete</Button>
                      )}
                      {locked && invoice.issued_at && (
                        <span className="text-[12px] text-muted-foreground">Issued {formatDate(invoice.issued_at)}</span>
                      )}
                    </div>

                    <PrintableInvoice invoice={invoice} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Text({
  label, value, onChange, type = 'text', disabled,
}: {
  label: string;
  value: string | number | boolean;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-muted-foreground mb-1">{label}</span>
      <input
        type={type}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-[var(--led-line)] bg-background px-2.5 py-1.5 text-[13px] text-foreground disabled:opacity-60"
      />
    </label>
  );
}

function Check({
  label, checked, onChange, disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="text-[13px] text-foreground">{label}</span>
    </label>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold text-foreground' : 'text-foreground'}>{value}</span>
    </div>
  );
}

/**
 * The document itself, laid out at A4 width and kept off-screen until the PDF
 * export clones it. Rendered from the same server-derived totals as the form
 * above, so the paper and the record can never disagree.
 */
function PrintableInvoice({ invoice }: { invoice: TaxInvoice }) {
  const heading = invoice.totals.is_tax_invoice ? 'Tax Invoice' : 'Invoice';
  const asset = [invoice.asset_year, invoice.asset_make, invoice.asset_model].filter(Boolean).join(' ');
  return (
    <div style={{ position: 'absolute', left: -10000, top: 0 }} aria-hidden>
      <div
        id={`tax-invoice-${invoice.id}`}
        style={{
          width: A4_PRINT_WIDTH_PX.portrait, background: '#ffffff', color: '#111827',
          padding: 48, fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13, lineHeight: 1.5,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{heading}</h1>
          <div style={{ textAlign: 'right', fontSize: 12 }}>
            {invoice.invoice_number && <div><strong>No.</strong> {invoice.invoice_number}</div>}
            {invoice.invoice_date && <div><strong>Date</strong> {formatDate(invoice.invoice_date)}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '0 0 4px' }}>From</p>
            <div style={{ fontWeight: 600 }}>{invoice.supplier_name || '—'}</div>
            {invoice.supplier_abn && <div>ABN {invoice.supplier_abn}</div>}
            {invoice.supplier_address && <div>{invoice.supplier_address}</div>}
            {invoice.supplier_email && <div>{invoice.supplier_email}</div>}
            {invoice.supplier_phone && <div>{invoice.supplier_phone}</div>}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '0 0 4px' }}>To</p>
            <div style={{ fontWeight: 600 }}>{invoice.buyer_name || '—'}</div>
            {invoice.buyer_abn && <div>ABN {invoice.buyer_abn}</div>}
            {invoice.buyer_address && <div>{invoice.buyer_address}</div>}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #d1d5db' }}>
              <th style={{ textAlign: 'left', padding: '8px 0', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '10px 0', verticalAlign: 'top' }}>
                <div>{invoice.asset_description || asset || '—'}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {[
                    asset && invoice.asset_description ? asset : '',
                    invoice.asset_vin ? `VIN/Serial ${invoice.asset_vin}` : '',
                    invoice.asset_registration ? `Rego ${invoice.asset_registration}` : '',
                    invoice.asset_odometer != null ? `${invoice.asset_odometer.toLocaleString('en-AU')} km` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
              </td>
              <td style={{ padding: '10px 0', textAlign: 'right' }}>{money(invoice.sale_price)}</td>
            </tr>
            {invoice.buyers_premium != null && (
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '10px 0' }}>Buyer&rsquo;s premium</td>
                <td style={{ padding: '10px 0', textAlign: 'right' }}>{money(invoice.buyers_premium)}</td>
              </tr>
            )}
            {invoice.other_charges != null && (
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '10px 0' }}>{invoice.other_charges_label || 'Other charges'}</td>
                <td style={{ padding: '10px 0', textAlign: 'right' }}>{money(invoice.other_charges)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ marginLeft: 'auto', width: 260, fontSize: 13 }}>
          <PrintRow label="Subtotal" value={money(invoice.totals.subtotal)} />
          <PrintRow
            label={invoice.totals.is_tax_invoice ? 'GST included in this total' : 'GST'}
            value={money(invoice.totals.gst)}
          />
          <PrintRow label="Total" value={money(invoice.totals.total)} strong />
          {invoice.totals.deposit_paid > 0 && <PrintRow label="Less deposit paid" value={money(invoice.totals.deposit_paid)} />}
          <PrintRow label="Balance due" value={money(invoice.totals.balance_due)} strong />
        </div>

        {!invoice.totals.is_tax_invoice && (
          <p style={{ marginTop: 20, fontSize: 11, color: '#6b7280' }}>
            The supplier is not registered for GST. No GST has been charged on this sale.
            {invoice.abn_withholding_declared && ' A statement by a supplier (no ABN) is held on file.'}
          </p>
        )}

        {(invoice.payout_account_name || invoice.payout_bsb || invoice.payout_account_number) && (
          <div style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #d1d5db', fontSize: 12 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '0 0 4px' }}>Payment</p>
            {invoice.payout_account_name && <div>{invoice.payout_account_name}</div>}
            <div>
              {invoice.payout_bsb ? `BSB ${invoice.payout_bsb}` : ''}
              {invoice.payout_account_number ? `  ACC ${invoice.payout_account_number}` : ''}
            </div>
          </div>
        )}

        {invoice.notes && <p style={{ marginTop: 20, fontSize: 12, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>}
      </div>
    </div>
  );
}

function PrintRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: strong ? '1px solid #d1d5db' : undefined }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}
