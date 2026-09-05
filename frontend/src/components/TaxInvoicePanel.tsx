import { Fragment, useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { Card, Badge, Button } from './ui';
import { getErrorMessage, formatDate } from '../lib/utils';
import { downloadElementPdf } from '../lib/pdfExport';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../lib/printPage';
import XpressPrintHeader from './print/XpressPrintHeader';
import type { SupplierType, TaxInvoice } from '../types';

/**
 * Tax invoices for the asset being financed.
 *
 * Three supplier kinds need three different documents. A dealer gets the desk's
 * Tax Invoice Request — the sheet sent on approval asking them to invoice us,
 * carrying the Sold To / Delivery To parties, the full identity of the goods and
 * the cost build-up. A private seller (usually charging no GST) and an auction
 * house (which adds a buyer's premium) get the invoice this desk raises itself,
 * following the ATO's tax-invoice requirements.
 *
 * An approved asset-finance application already has its dealer request waiting
 * as a draft — see services/tax_invoice.ensure_request_for_approval.
 *
 * Totals are never computed here — the server derives them, so the printed
 * document can't disagree with the record.
 */

const SUPPLIER_LABEL: Record<SupplierType, string> = {
  dealer: 'Dealer',
  private: 'Private seller',
  auction: 'Auction house',
};

/** What the printed document calls itself, which is not the same question as
 *  who the supplier is: a dealer document is a request for their invoice. */
const DOCUMENT_LABEL: Record<SupplierType, string> = {
  dealer: 'Tax invoice request',
  private: 'Invoice',
  auction: 'Tax invoice',
};

/** Verbatim from the desk's request sheet. These are the terms the dealer is
 *  agreeing to by releasing the goods, so they are not paraphrased. */
const RELEASE_CONDITIONS = [
  "The goods will only be released upon clearance of funds in full in the nominated seller's account.",
  'This includes payment from the lender and any other outstanding/unpaid deposit amount, if applicable.',
  'All transactions to be completed electronically.',
];

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

  /** Re-derive the Sold To party from the application. The draft is raised at
   *  approval, so a broker who afterwards corrects who the applicant is needs a
   *  way to pull that through without retyping the block. */
  const refreshBuyer = async (invoice: TaxInvoice) => {
    setSaving(true);
    try {
      await api.post(`/applications/${applicationId}/tax-invoices/${invoice.id}/refresh-buyer`);
      // Drop any unsaved edits to the buyer block — they've just been replaced.
      setDraft((prev) => {
        const next = { ...prev };
        for (const key of ['buyer_name', 'buyer_abn', 'buyer_acn', 'buyer_address'] as const) {
          delete next[key];
        }
        return next;
      });
      await load();
      toast('Sold To updated from the application', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to update the Sold To party'), 'error');
    } finally {
      setSaving(false);
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
            // A dealer document is a request for their invoice, not one we raise.
            const isRequest = invoice.supplier_type === 'dealer';
            const sameDelivery = Boolean(draft.delivery_same_as_buyer ?? invoice.delivery_same_as_buyer);
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
                    {DOCUMENT_LABEL[invoice.supplier_type]}
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

                    <Section title={isRequest ? 'Request' : 'Invoice'}>
                      <Text label={isRequest ? 'Reference' : 'Invoice number'} value={field(invoice, 'invoice_number')} onChange={(v) => set('invoice_number', v)} disabled={locked} />
                      <Text label={isRequest ? 'Date' : 'Invoice date'} type="date" value={field(invoice, 'invoice_date')} onChange={(v) => set('invoice_date', v)} disabled={locked} />
                      {isRequest && (
                        <>
                          <Text label="Attention" value={field(invoice, 'attention')} onChange={(v) => set('attention', v)} disabled={locked} />
                          <Text label="Fax number" value={field(invoice, 'fax_number')} onChange={(v) => set('fax_number', v)} disabled={locked} />
                          <Text label="Dealer emails the invoice back to" value={field(invoice, 'reply_to_email')} onChange={(v) => set('reply_to_email', v)} disabled={locked} />
                        </>
                      )}
                    </Section>

                    <Section title={isRequest ? 'Dealer' : 'Supplier'}>
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

                    <Section title={`${isRequest ? 'Sold to' : 'Buyer'}${invoice.totals.buyer_identity_required ? ' (required at $1,000 or more)' : ''}`}>
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => refreshBuyer(invoice)}
                          disabled={saving}
                          className="text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          Use the application's applicant
                        </button>
                      )}
                      <Text label="Name" value={field(invoice, 'buyer_name')} onChange={(v) => set('buyer_name', v)} disabled={locked} />
                      <Text label="ABN" value={field(invoice, 'buyer_abn')} onChange={(v) => set('buyer_abn', v)} disabled={locked} />
                      <Text label="ACN" value={field(invoice, 'buyer_acn')} onChange={(v) => set('buyer_acn', v)} disabled={locked} />
                      <Text label="Address" value={field(invoice, 'buyer_address')} onChange={(v) => set('buyer_address', v)} disabled={locked} />
                    </Section>

                    {isRequest && (
                      <Section title="Delivery to">
                        <Check
                          label="Same as sold to"
                          checked={sameDelivery}
                          onChange={(v) => set('delivery_same_as_buyer', v)}
                          disabled={locked}
                        />
                        {!sameDelivery && (
                          <>
                            <Text label="Name" value={field(invoice, 'delivery_name')} onChange={(v) => set('delivery_name', v)} disabled={locked} />
                            <Text label="ABN" value={field(invoice, 'delivery_abn')} onChange={(v) => set('delivery_abn', v)} disabled={locked} />
                            <Text label="ACN" value={field(invoice, 'delivery_acn')} onChange={(v) => set('delivery_acn', v)} disabled={locked} />
                            <Text label="Address" value={field(invoice, 'delivery_address')} onChange={(v) => set('delivery_address', v)} disabled={locked} />
                          </>
                        )}
                      </Section>
                    )}

                    <Section title="Asset">
                      <Text label="Description" value={field(invoice, 'asset_description')} onChange={(v) => set('asset_description', v)} disabled={locked} />
                      <Text label="Make" value={field(invoice, 'asset_make')} onChange={(v) => set('asset_make', v)} disabled={locked} />
                      <Text label="Model" value={field(invoice, 'asset_model')} onChange={(v) => set('asset_model', v)} disabled={locked} />
                      <Text label="Year" value={field(invoice, 'asset_year')} onChange={(v) => set('asset_year', v)} disabled={locked} />
                      <Text label="VIN / serial" value={field(invoice, 'asset_vin')} onChange={(v) => set('asset_vin', v)} disabled={locked} />
                      <Text label="Registration" value={field(invoice, 'asset_registration')} onChange={(v) => set('asset_registration', v)} disabled={locked} />
                      <Text label="Odometer" type="number" value={field(invoice, 'asset_odometer')} onChange={(v) => set('asset_odometer', v === '' ? null : Number(v))} disabled={locked} />
                      <Choice
                        label="New or used"
                        value={String(field(invoice, 'asset_condition'))}
                        options={[['', '—'], ['new', 'New'], ['used', 'Used']]}
                        onChange={(v) => set('asset_condition', v || null)}
                        disabled={locked}
                      />
                      <Text label="Engine number" value={field(invoice, 'asset_engine_number')} onChange={(v) => set('asset_engine_number', v)} disabled={locked} />
                      <Text label="Build date" value={field(invoice, 'asset_build_date')} onChange={(v) => set('asset_build_date', v)} disabled={locked} />
                      <Text label="Compliance date" value={field(invoice, 'asset_compliance_date')} onChange={(v) => set('asset_compliance_date', v)} disabled={locked} />
                      <Text label="Colour" value={field(invoice, 'asset_colour')} onChange={(v) => set('asset_colour', v)} disabled={locked} />
                      <Text label="Registration expiry" value={field(invoice, 'asset_registration_expiry')} onChange={(v) => set('asset_registration_expiry', v)} disabled={locked} />
                    </Section>

                    <Section title="Amounts">
                      <Text label="Sale price" type="number" value={field(invoice, 'sale_price')} onChange={(v) => set('sale_price', v === '' ? null : Number(v))} disabled={locked} />
                      {invoice.supplier_type === 'auction' && (
                        <Text label="Buyer's premium" type="number" value={field(invoice, 'buyers_premium')} onChange={(v) => set('buyers_premium', v === '' ? null : Number(v))} disabled={locked} />
                      )}
                      <Text label="Other charges" type="number" value={field(invoice, 'other_charges')} onChange={(v) => set('other_charges', v === '' ? null : Number(v))} disabled={locked} />
                      <Text label="Other charges — label" value={field(invoice, 'other_charges_label')} onChange={(v) => set('other_charges_label', v)} disabled={locked} />
                      <Text label="Less trade in" type="number" value={field(invoice, 'trade_in_value')} onChange={(v) => set('trade_in_value', v === '' ? null : Number(v))} disabled={locked} />
                      <Text label="Payout of the loan (if any)" type="number" value={field(invoice, 'payout_amount')} onChange={(v) => set('payout_amount', v === '' ? null : Number(v))} disabled={locked} />
                      <Text label="Less cash deposit" type="number" value={field(invoice, 'deposit_paid')} onChange={(v) => set('deposit_paid', v === '' ? null : Number(v))} disabled={locked} />
                    </Section>

                    <Section title="Pay the supplier">
                      <Text label="Account name" value={field(invoice, 'payout_account_name')} onChange={(v) => set('payout_account_name', v)} disabled={locked} />
                      <Text label="BSB" value={field(invoice, 'payout_bsb')} onChange={(v) => set('payout_bsb', v)} disabled={locked} />
                      <Text label="Account number" value={field(invoice, 'payout_account_number')} onChange={(v) => set('payout_account_number', v)} disabled={locked} />
                    </Section>

                    <div className="rounded-md bg-secondary px-3 py-2 text-[12.5px] tabular-nums">
                      <Row label={isRequest ? 'Cash price' : 'Subtotal'} value={money(invoice.totals.subtotal)} />
                      <Row label={invoice.totals.is_tax_invoice ? 'GST included' : 'GST'} value={money(invoice.totals.gst)} />
                      {invoice.totals.trade_in > 0 && <Row label="Less trade in" value={money(invoice.totals.trade_in)} />}
                      {invoice.totals.payout > 0 && <Row label="Payout of the loan" value={money(invoice.totals.payout)} />}
                      <Row label={isRequest ? 'Less cash deposit' : 'Deposit paid'} value={money(invoice.totals.deposit_paid)} />
                      <Row label={isRequest ? 'Total payable for goods' : 'Balance due'} value={money(invoice.totals.balance_due)} strong />
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
                      <Button type="button" variant="secondary" onClick={() => downloadElementPdf(`tax-invoice-${invoice.id}`, pdfFilename(invoice))}>
                        Download PDF
                      </Button>
                      {!locked && (
                        <Button type="button" variant="secondary" onClick={() => remove(invoice)}>Delete</Button>
                      )}
                      {locked && invoice.issued_at && (
                        <span className="text-[12px] text-muted-foreground">Issued {formatDate(invoice.issued_at)}</span>
                      )}
                    </div>

                    <PrintableDocument invoice={invoice} />
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

function Choice({
  label, value, options, onChange, disabled,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-muted-foreground mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-[var(--led-line)] bg-background px-2.5 py-1.5 text-[13px] text-foreground disabled:opacity-60"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** Named so a dealer can file the attachment without opening it. */
function pdfFilename(invoice: TaxInvoice): string {
  const who = invoice.supplier_name || invoice.buyer_name || 'dealer';
  const stem = invoice.supplier_type === 'dealer' ? 'tax-invoice-request' : 'tax-invoice';
  const ref = invoice.invoice_number || who;
  return `${stem}-${ref}`.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase() + '.pdf';
}

/* ---------------------------------------------------------------------------
 * The printed documents.
 *
 * Laid out at A4 width and kept off-screen until the PDF export clones it.
 * Rendered from the same server-derived totals as the form above, so the paper
 * and the record can never disagree. All styling is inline: html2canvas can't
 * parse Tailwind's modern colour values (see lib/pdfExport).
 * ------------------------------------------------------------------------- */

// Brand tokens shared with the masthead and the painted footer band.
const NAVY = '#0d1f3c';
const GOLD = '#c8962e';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const EMPTY = '—';

/** A4 page carrying the Xpress masthead, with the body inset below it. The
 *  masthead is full-bleed, so the inset lives on this wrapper rather than on
 *  the page. The footer band is painted onto every page afterwards. */
function DocumentShell({
  invoice, eyebrow, title, subtitle, children,
}: {
  invoice: TaxInvoice;
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: 'absolute', left: -10000, top: 0 }} aria-hidden>
      <div
        id={`tax-invoice-${invoice.id}`}
        style={{
          // Exactly the PDF's inner page width — html2pdf crops anything wider
          // rather than scaling it down, and overflow:hidden keeps scrollWidth
          // equal to it so html2canvas can't shift the capture.
          width: A4_PRINT_WIDTH_PX.portrait, overflow: 'hidden',
          background: '#ffffff', color: '#111827',
          fontFamily: SANS, fontSize: 11, lineHeight: 1.4,
        }}
      >
        <XpressPrintHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
        <div style={{ padding: `0 ${PRINT_INSET}px 12px` }}>{children}</div>
      </div>
    </div>
  );
}

function PrintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, borderBottom: `1px solid ${LINE}`, paddingBottom: 3, marginBottom: 6 }}>
        <span style={{ width: 5, height: 5, background: GOLD, transform: 'rotate(45deg)', display: 'inline-block', flex: 'none' }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: NAVY }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

/** One party — the sold-to / delivery-to / from blocks all print like this. */
function PartyBlock({
  heading, name, abn, acn, lines,
}: {
  heading: string;
  name: string | null;
  abn?: string | null;
  acn?: string | null;
  lines?: (string | null)[];
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 3 }}>
        {heading}
      </div>
      <div style={{ fontWeight: 700, fontSize: 12 }}>{name || EMPTY}</div>
      {/* Addresses are stored with newlines between street and locality. */}
      {(lines ?? []).filter(Boolean).map((line, i) => (
        <div key={i} style={{ whiteSpace: 'pre-line' }}>{line}</div>
      ))}
      {(abn || acn) && (
        <div>{[abn && `ABN ${abn}`, acn && `ACN ${acn}`].filter(Boolean).join('  ·  ')}</div>
      )}
    </div>
  );
}

/**
 * Label/value rows for the goods. Every row prints, blanks included — a blank
 * is what the dealer is being asked to confirm.
 *
 * Rows arrive pre-grouped: two pairs to a line, or one pair spanning the line
 * where the value is long (the full model string, the rego and its expiry).
 * Grouping is the caller's call rather than a chunking rule here, because only
 * the caller knows which values run long. A table rather than a grid — it is
 * what html2canvas renders most predictably.
 */
function GoodsTable({ rows }: { rows: [string, string][][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <tbody>
        {rows.map((pairs, i) => (
          <tr key={pairs[0][0]} style={{ background: i % 2 ? '#f8fafc' : '#ffffff' }}>
            {pairs.map(([k, v]) => (
              <Fragment key={k}>
                <td style={{ padding: '3px 8px', width: '21%', color: MUTED, verticalAlign: 'top' }}>{k}</td>
                <td
                  colSpan={pairs.length === 1 ? 3 : 1}
                  style={{ padding: '3px 8px', width: pairs.length === 1 ? undefined : '29%', fontWeight: 600, verticalAlign: 'top' }}
                >
                  {v || EMPTY}
                </td>
              </Fragment>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', padding: strong ? '5px 0 0' : '2px 0',
        borderTop: strong ? `1px solid ${LINE}` : undefined,
        fontSize: muted ? 10.5 : 12,
        color: muted ? MUTED : undefined,
      }}
    >
      <span style={{ color: muted ? MUTED : '#374151' }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 500, color: strong ? NAVY : undefined }}>{value}</span>
    </div>
  );
}

function PrintableDocument({ invoice }: { invoice: TaxInvoice }) {
  return invoice.supplier_type === 'dealer'
    ? <RequestDocument invoice={invoice} />
    : <InvoiceDocument invoice={invoice} />;
}

/**
 * The Tax Invoice Request sent to the dealer: who it is addressed to, who the
 * goods are sold and delivered to, exactly what they are, what is payable, and
 * the conditions the goods are released under.
 */
function RequestDocument({ invoice }: { invoice: TaxInvoice }) {
  const t = invoice.totals;
  const deliverySame = invoice.delivery_same_as_buyer;
  const buildCompliance = [invoice.asset_build_date, invoice.asset_compliance_date].filter(Boolean).join(' and ');
  const rego = [
    invoice.asset_registration,
    invoice.asset_registration_expiry ? `expires ${invoice.asset_registration_expiry}` : '',
  ].filter(Boolean).join(' · ');
  const condition = invoice.asset_condition
    ? invoice.asset_condition.charAt(0).toUpperCase() + invoice.asset_condition.slice(1)
    : '';

  return (
    <DocumentShell
      invoice={invoice}
      eyebrow="Asset Finance · Dealer"
      title="Tax Invoice Request"
      subtitle={invoice.supplier_name || undefined}
    >
      <div className="break-inside-avoid" style={{ display: 'flex', gap: 24, marginTop: 12 }}>
        <PartyBlock
          heading="To"
          name={invoice.supplier_name}
          abn={invoice.supplier_abn}
          lines={[
            invoice.attention ? `Attention: ${invoice.attention}` : null,
            invoice.supplier_address,
            invoice.supplier_email,
            [
              invoice.supplier_phone ? `Ph ${invoice.supplier_phone}` : '',
              invoice.fax_number ? `Fax ${invoice.fax_number}` : '',
            ].filter(Boolean).join('  ·  ') || null,
          ]}
        />
        <div style={{ flex: 'none', textAlign: 'right' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Date</div>
          <div style={{ fontWeight: 600 }}>{invoice.invoice_date ? formatDate(invoice.invoice_date) : EMPTY}</div>
          {invoice.invoice_number && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginTop: 8 }}>Reference</div>
              <div style={{ fontWeight: 600 }}>{invoice.invoice_number}</div>
            </>
          )}
        </div>
      </div>

      <PrintSection title="Parties">
        <div className="break-inside-avoid" style={{ display: 'flex', gap: 24 }}>
          <PartyBlock
            heading="Sold to"
            name={invoice.buyer_name}
            abn={invoice.buyer_abn}
            acn={invoice.buyer_acn}
            lines={[invoice.buyer_address]}
          />
          <PartyBlock
            heading="Delivery to"
            name={deliverySame ? invoice.buyer_name : invoice.delivery_name}
            abn={deliverySame ? invoice.buyer_abn : invoice.delivery_abn}
            acn={deliverySame ? invoice.buyer_acn : invoice.delivery_acn}
            lines={[deliverySame ? invoice.buyer_address : invoice.delivery_address]}
          />
        </div>
      </PrintSection>

      <PrintSection title="Full details of goods to be financed">
        <GoodsTable
          rows={[
            [['New or used', condition], ['Year', invoice.asset_year || '']],
            [['Make', invoice.asset_make || ''], ['Colour', invoice.asset_colour || '']],
            [['Model (full details)', invoice.asset_model || invoice.asset_description || '']],
            [['VIN or chassis number', invoice.asset_vin || ''], ['Engine number', invoice.asset_engine_number || '']],
            [['Build and compliance date', buildCompliance], ['Odometer', invoice.asset_odometer != null ? `${invoice.asset_odometer.toLocaleString('en-AU')} km` : '']],
            [['Registration details including expiry', rego]],
          ]}
        />
      </PrintSection>

      <PrintSection title="Full cost of goods">
        <div className="break-inside-avoid" style={{ marginLeft: 'auto', width: 330 }}>
          <PrintRow label="Cash price (GST inclusive)" value={money(invoice.sale_price)} />
          <PrintRow label="GST included in the cash price" value={money(t.gst)} muted />
          {invoice.other_charges != null && (
            <PrintRow label={invoice.other_charges_label || 'Other charges'} value={money(invoice.other_charges)} />
          )}
          <PrintRow label="Less trade in" value={money(t.trade_in)} />
          <PrintRow label="Payout of the loan (if any)" value={money(t.payout)} />
          <PrintRow label="Less cash deposit" value={money(t.deposit_paid)} />
          <PrintRow label="Total payable for goods" value={money(t.balance_due)} strong />
        </div>
      </PrintSection>

      <PrintSection title="Conditions for the release of the goods">
        {/* Numbered by hand: the app's CSS reset strips list markers, and
            html2canvas paints markers unreliably even where they survive. */}
        <div className="break-inside-avoid">
          {RELEASE_CONDITIONS.map((c, i) => (
            <div key={c} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
              <span style={{ color: MUTED, flex: 'none' }}>{i + 1})</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
      </PrintSection>

      <div
        className="break-inside-avoid"
        style={{ marginTop: 12, padding: '9px 12px', background: '#f8fafc', borderLeft: `3px solid ${GOLD}` }}
      >
        <div>
          In order to deliver funds, please email back the <strong>TAX INVOICE</strong> at the earliest
          with a copy of your deposit slip.
        </div>
        <div style={{ marginTop: 4 }}>
          Please email to — <strong>{invoice.reply_to_email || EMPTY}</strong>
        </div>
      </div>

      {(invoice.payout_account_name || invoice.payout_bsb || invoice.payout_account_number) && (
        <PrintSection title="Nominated seller's account">
          <div className="break-inside-avoid">
            {invoice.payout_account_name && <div>{invoice.payout_account_name}</div>}
            <div>
              {invoice.payout_bsb ? `BSB ${invoice.payout_bsb}` : ''}
              {invoice.payout_account_number ? `  ACC ${invoice.payout_account_number}` : ''}
            </div>
          </div>
        </PrintSection>
      )}

      {invoice.notes && (
        <p className="break-inside-avoid" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
      )}
    </DocumentShell>
  );
}

/**
 * The invoice this desk raises itself — a private seller or an auction house,
 * where there is no dealer to request a document from.
 */
function InvoiceDocument({ invoice }: { invoice: TaxInvoice }) {
  const t = invoice.totals;
  const heading = t.is_tax_invoice ? 'Tax Invoice' : 'Invoice';
  const asset = [invoice.asset_year, invoice.asset_make, invoice.asset_model].filter(Boolean).join(' ');
  return (
    <DocumentShell
      invoice={invoice}
      eyebrow={`Asset Finance · ${SUPPLIER_LABEL[invoice.supplier_type]}`}
      title={heading}
      subtitle={[
        invoice.invoice_number ? `No. ${invoice.invoice_number}` : '',
        invoice.invoice_date ? formatDate(invoice.invoice_date) : '',
      ].filter(Boolean).join(' · ') || undefined}
    >
      <div className="break-inside-avoid" style={{ display: 'flex', gap: 24, marginTop: 12 }}>
        <PartyBlock
          heading="From"
          name={invoice.supplier_name}
          abn={invoice.supplier_abn}
          lines={[invoice.supplier_address, invoice.supplier_email, invoice.supplier_phone]}
        />
        <PartyBlock
          heading="To"
          name={invoice.buyer_name}
          abn={invoice.buyer_abn}
          acn={invoice.buyer_acn}
          lines={[invoice.buyer_address]}
        />
      </div>

      <PrintSection title="What is being sold">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${LINE}` }}>
              <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.14em', color: MUTED }}>Description</th>
              <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.14em', color: MUTED }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 0', verticalAlign: 'top' }}>
                <div>{invoice.asset_description || asset || EMPTY}</div>
                <div style={{ fontSize: 10.5, color: MUTED }}>
                  {[
                    asset && invoice.asset_description ? asset : '',
                    invoice.asset_vin ? `VIN/Serial ${invoice.asset_vin}` : '',
                    invoice.asset_engine_number ? `Engine ${invoice.asset_engine_number}` : '',
                    invoice.asset_registration ? `Rego ${invoice.asset_registration}` : '',
                    invoice.asset_colour || '',
                    invoice.asset_odometer != null ? `${invoice.asset_odometer.toLocaleString('en-AU')} km` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
              </td>
              <td style={{ padding: '8px 0', textAlign: 'right' }}>{money(invoice.sale_price)}</td>
            </tr>
            {invoice.buyers_premium != null && (
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px 0' }}>Buyer&rsquo;s premium</td>
                <td style={{ padding: '8px 0', textAlign: 'right' }}>{money(invoice.buyers_premium)}</td>
              </tr>
            )}
            {invoice.other_charges != null && (
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px 0' }}>{invoice.other_charges_label || 'Other charges'}</td>
                <td style={{ padding: '8px 0', textAlign: 'right' }}>{money(invoice.other_charges)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="break-inside-avoid" style={{ marginLeft: 'auto', width: 300, marginTop: 10 }}>
          <PrintRow label="Subtotal" value={money(t.subtotal)} />
          <PrintRow label={t.is_tax_invoice ? 'GST included in this total' : 'GST'} value={money(t.gst)} muted />
          {t.trade_in > 0 && <PrintRow label="Less trade in" value={money(t.trade_in)} />}
          {t.payout > 0 && <PrintRow label="Payout of the loan" value={money(t.payout)} />}
          {t.deposit_paid > 0 && <PrintRow label="Less deposit paid" value={money(t.deposit_paid)} />}
          <PrintRow label="Balance due" value={money(t.balance_due)} strong />
        </div>
      </PrintSection>

      {!t.is_tax_invoice && (
        <p className="break-inside-avoid" style={{ marginTop: 16, fontSize: 10.5, color: MUTED }}>
          The supplier is not registered for GST. No GST has been charged on this sale.
          {invoice.abn_withholding_declared && ' A statement by a supplier (no ABN) is held on file.'}
        </p>
      )}

      {(invoice.payout_account_name || invoice.payout_bsb || invoice.payout_account_number) && (
        <PrintSection title="Payment">
          <div className="break-inside-avoid">
            {invoice.payout_account_name && <div>{invoice.payout_account_name}</div>}
            <div>
              {invoice.payout_bsb ? `BSB ${invoice.payout_bsb}` : ''}
              {invoice.payout_account_number ? `  ACC ${invoice.payout_account_number}` : ''}
            </div>
          </div>
        </PrintSection>
      )}

      {invoice.notes && (
        <p className="break-inside-avoid" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
      )}
    </DocumentShell>
  );
}
