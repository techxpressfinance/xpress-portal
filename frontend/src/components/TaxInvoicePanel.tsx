import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { useConfirm } from '../hooks/useConfirm';
import { Card, Badge, Button } from './ui';
import { getErrorMessage, formatDate } from '../lib/utils';
import { downloadElementPdf, elementPdfBlob } from '../lib/pdfExport';
import { A4_PRINT_WIDTH_PX, PRINT_INSET } from '../lib/printPage';
import XpressPrintHeader from './print/XpressPrintHeader';
import type { AbnStatus, InvoiceFacilityType, Lender, SupplierType, TaxInvoice, TaxInvoiceParty } from '../types';

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
 * The facility decides who the dealer sells to: on a chattel mortgage the client
 * is both Sold To and Delivery To; on any lease or hire purchase the lender buys
 * the goods (Sold To) and the client takes delivery. The server derives both
 * blocks (`sold_to`/`deliver_to`) so the form and the paper agree.
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

/** What each kind of document is, shown before one is created so the broker
 *  picks deliberately rather than by the first button they see. */
const SUPPLIER_HELP: Record<SupplierType, string> = {
  dealer: 'A tax invoice request sent to the dealer, who sends their tax invoice back.',
  private: 'An invoice issued by a private seller — a tax invoice only if their ABN is GST-registered.',
  auction: "The auction house's tax invoice, including the buyer's premium.",
};

const ABN_STATUS_LABEL: Record<AbnStatus, string> = {
  active: 'Active',
  cancelled: 'Cancelled',
  not_found: 'Not found on ABN Lookup',
  none: 'Seller has no ABN',
};

/** A yes/no prompt that starts unanswered — null is "not asked yet", which the
 *  server treats as a gap, never as a no. */
const YES_NO: [string, string][] = [['', 'Not answered'], ['yes', 'Yes'], ['no', 'No']];
const yesNoValue = (v: string | number | boolean) => (v === true ? 'yes' : v === false ? 'no' : '');
const yesNoParse = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);

const FACILITY_LABEL: Record<InvoiceFacilityType, string> = {
  chattel: 'Chattel mortgage',
  hp: 'Hire purchase',
  lease: 'Lease',
  novated_lease: 'Novated lease',
};

/** Verbatim from the desk's request sheet. These are the terms the dealer is
 *  agreeing to by releasing the goods, so they are not paraphrased. */
const RELEASE_CONDITIONS = [
  "The goods will only be released upon clearance of funds in full in the nominated seller's account.",
  'This includes payment from the lender and any other outstanding/unpaid deposit amount, if applicable.',
  'All transactions to be completed electronically.',
];

/** Odometer bands from the desk's calculation sheet. A reading is objective
 *  where a seller's description is an opinion, so it settles the question.
 *  Kept in sync with classify_condition in backend services/tax_invoice.py. */
const NEW_ODOMETER_CEILING = 500;
const DEMO_ODOMETER_CEILING = 5_000;

const CONDITION_LABEL: Record<string, string> = { new: 'New', demo: 'Demo', used: 'Used' };

/** What the odometer says the asset is, or null with no reading — equipment is
 *  metered in hours, so only a vehicle answers this. */
function classifyByOdometer(value: string | number | boolean): string | null {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  const km = Number(value);
  if (!Number.isFinite(km)) return null;
  if (km <= NEW_ODOMETER_CEILING) return 'new';
  if (km <= DEMO_ODOMETER_CEILING) return 'demo';
  return 'used';
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The fields the form edits — everything on the invoice except the
 *  server-derived `totals`/`missing` and the read-only audit stamps. */
type EditableField = {
  [K in keyof TaxInvoice]: TaxInvoice[K] extends string | number | boolean | null ? K : never
}[keyof TaxInvoice];

type Draft = Partial<Record<EditableField, string | number | boolean | null>>;

export default function TaxInvoicePanel({
  applicationId,
  /** Set when the broker arrived by "Generate tax invoice" rather than by
   *  opening the tab: put the dealer request in front of them, raising it
   *  first if approval never did (an application approved before the hook
   *  existed, or moved through a board that skipped it). */
  autoOpen = false,
}: { applicationId: string; autoOpen?: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  // Seller-document ticks, saved with the rest of the draft.
  const [docDraft, setDocDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // The tenant's lender list, so the financier on the document is a real lender
  // rather than a typed name. Empty after a failure — the field then shows what
  // the lender pricing already recorded and nothing else.
  const [lenderBook, setLenderBook] = useState<Lender[]>([]);

  useEffect(() => {
    api.get<Lender[]>('/lenders')
      .then(({ data }) => setLenderBook(data))
      .catch(() => setLenderBook([]));
  }, []);

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

  // Once per arrival — re-running would fight the broker every time they
  // collapsed the row, and could raise a second document to reconcile.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || loading || autoOpened.current) return;
    autoOpened.current = true;
    const dealer = invoices.find((i) => i.supplier_type === 'dealer');
    if (dealer) {
      setOpenId(dealer.id);
      setDraft({});
    } else {
      create('dealer');
    }
  }, [autoOpen, loading, invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  // The "New invoice" chooser, and the type picked in it. Creating is a
  // deliberate two-step so a stray click can't leave a draft behind.
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<SupplierType | null>(null);
  const [creating, setCreating] = useState(false);
  // Drafts ticked for bulk delete.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const closeChooser = () => { setChoosing(false); setPicked(null); };

  const openInvoice = (id: string) => {
    setOpenId(id);
    setDraft({});
    setDocDraft({});
  };

  const create = async (supplierType: SupplierType) => {
    // Ignores a second click while the first is still in flight.
    if (creating) return;
    setCreating(true);
    try {
      const { data } = await api.post(`/applications/${applicationId}/tax-invoices`, { supplier_type: supplierType });
      await load();
      openInvoice(data.id);
      closeChooser();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to start the invoice'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const dirty = Object.keys(draft).length > 0 || Object.keys(docDraft).length > 0;

  const save = async (invoice: TaxInvoice) => {
    if (!dirty) return;
    setSaving(true);
    try {
      await api.patch(`/applications/${applicationId}/tax-invoices/${invoice.id}`, {
        ...draft,
        ...(Object.keys(docDraft).length ? { seller_documents: docDraft } : {}),
      });
      setDraft({});
      setDocDraft({});
      await load();
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const [emailing, setEmailing] = useState<string | null>(null);

  /** Send the issued document to the broker on the file and the admins. The
   *  PDF is rendered here from the same markup Download captures, so what they
   *  receive is exactly what is on screen. */
  const email = async (invoice: TaxInvoice) => {
    setEmailing(invoice.id);
    try {
      const pdf = await elementPdfBlob(`tax-invoice-${invoice.id}`);
      if (!pdf) throw new Error('Could not render the PDF');
      const form = new FormData();
      form.append('file', pdf, pdfFilename(invoice));
      const { data } = await api.post<TaxInvoice & { emailed_to: string[] }>(
        `/applications/${applicationId}/tax-invoices/${invoice.id}/email`, form,
      );
      await load();
      toast(`Sent to ${data.emailed_to.join(', ')}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to email the document'), 'error');
    } finally {
      setEmailing(null);
    }
  };

  const issue = async (invoice: TaxInvoice) => {
    try {
      const { data } = await api.post<TaxInvoice>(`/applications/${applicationId}/tax-invoices/${invoice.id}/issue`);
      await load();
      toast('Invoice issued', 'success');
      // Once issued it goes to the broker and the admins without a second click.
      await email(data);
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to issue'), 'error');
    }
  };

  /** Check the seller's ABN on ABN Lookup. The answer decides the document:
   *  only an active, GST-registered ABN makes a private sale a tax invoice.
   *  Unsaved edits go first so the check runs on the ABN on screen. */
  const checkAbn = async (invoice: TaxInvoice) => {
    setSaving(true);
    try {
      if (dirty) await save(invoice);
      const { data } = await api.post<TaxInvoice>(`/applications/${applicationId}/tax-invoices/${invoice.id}/abn-lookup`);
      await load();
      toast(`ABN Lookup: ${ABN_STATUS_LABEL[data.supplier_abn_status as AbnStatus]} — ${data.document_title.toLowerCase()}`, 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'ABN Lookup failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Re-derive the Sold To party from the application. The draft is raised at
   *  approval, so a broker who afterwards corrects who the applicant is needs a
   *  way to pull that through without retyping the block. */
  /** Re-pull the cost build-up from the latest lender pricing. The draft is
   *  raised at approval, often before the deal is finally priced, and a deal can
   *  be re-priced or move lender afterwards. */
  const refreshPricing = async (invoice: TaxInvoice) => {
    setSaving(true);
    try {
      await api.post(`/applications/${applicationId}/tax-invoices/${invoice.id}/refresh-pricing`);
      // Drop unsaved edits to the figures the pricing owns — just replaced.
      setDraft((prev) => {
        const next = { ...prev };
        for (const key of ['sale_price', 'deposit_paid', 'trade_in_value', 'payout_amount', 'lender_id', 'facility_type'] as const) {
          delete next[key];
        }
        return next;
      });
      await load();
      toast('Amounts updated from the lender pricing', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to pull the lender pricing'), 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Delete every ticked draft behind one confirmation. Issued documents can't
   *  be ticked — the server refuses to delete them anyway. */
  const removeSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirm({
      title: `Delete ${ids.length} draft${ids.length > 1 ? 's' : ''}?`,
      message: 'The selected drafts and their figures are removed permanently. Issued documents are not affected.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      ids.map((id) => api.delete(`/applications/${applicationId}/tax-invoices/${id}`)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (openId && ids.includes(openId)) setOpenId(null);
    setSelected(new Set());
    await load();
    if (failed) toast(`${failed} could not be deleted`, 'error');
    else toast(`Deleted ${ids.length} draft${ids.length > 1 ? 's' : ''}`, 'success');
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async (invoice: TaxInvoice) => {
    if (!(await confirm({ title: 'Delete this tax invoice?', message: 'The request sheet and its figures are removed permanently.', confirmText: 'Delete', variant: 'danger' }))) return;
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
        <div className="flex items-center gap-1.5">
          {selected.size > 0 && (
            <>
              <Button type="button" variant="secondary" onClick={() => setSelected(new Set())}>Clear</Button>
              <Button type="button" variant="danger" onClick={removeSelected}>
                Delete {selected.size} draft{selected.size > 1 ? 's' : ''}
              </Button>
            </>
          )}
          {!choosing && (
            <Button type="button" variant="secondary" onClick={() => setChoosing(true)}>+ New invoice</Button>
          )}
        </div>
      </div>

      {choosing && (
        <NewInvoiceChooser
          invoices={invoices}
          picked={picked}
          creating={creating}
          onPick={setPicked}
          onCreate={create}
          onOpen={(id) => { openInvoice(id); closeChooser(); }}
          onCancel={closeChooser}
        />
      )}

      {duplicateDrafts(invoices).length > 0 && (
        <p className="mb-2 rounded-md bg-secondary px-3 py-2 text-[12.5px] text-foreground">
          {duplicateDrafts(invoices).map(([type, n]) => `${n} ${SUPPLIER_LABEL[type].toLowerCase()} drafts`).join(' and ')}{' '}
          on this deal. Unless it is buying more than one asset, tick the extras and delete them.
        </p>
      )}

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
            const hasPayout = invoice.totals.asset_payout > 0;
            // Follows the unsaved choice so the party labels switch as the broker picks.
            const facility = (field(invoice, 'facility_type') || null) as InvoiceFacilityType | null;
            const lenderBuys = isRequest && facility != null && facility !== 'chattel';
            const isPrivate = invoice.supplier_type === 'private';
            const docReceived = (key: string, fallback: boolean) => docDraft[key] ?? fallback;
            const odometerSuggestion = classifyByOdometer(field(invoice, 'asset_odometer'));
            return (
              <div key={invoice.id} className={`rounded-lg border ${selected.has(invoice.id) ? 'border-danger/50' : 'border-[var(--led-line)]'}`}>
                <div className="flex items-center gap-2 pl-3">
                {/* Only a draft can be deleted, so only a draft can be ticked. */}
                <input
                  type="checkbox"
                  aria-label="Select this draft"
                  checked={selected.has(invoice.id)}
                  onChange={() => toggleSelected(invoice.id)}
                  disabled={locked}
                  className={locked ? 'invisible' : ''}
                />
                <button
                  type="button"
                  onClick={() => (open ? setOpenId(null) : openInvoice(invoice.id))}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 text-left"
                >
                  <Badge
                    type="custom"
                    value={invoice.status}
                    label={locked ? 'Issued' : 'Draft'}
                    className={locked ? 'led-chip-success' : ''}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-foreground">
                      {invoice.document_title}
                      <span className="font-normal text-muted-foreground">
                        {' · '}{invoice.supplier_name || (isRequest ? 'dealer not entered' : 'seller not entered')}
                        {invoice.invoice_number ? ` · ${invoice.invoice_number}` : ''}
                      </span>
                    </span>
                    {/* Enough to tell two drafts of the same kind apart. */}
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {invoice.buyer_name ? `For ${invoice.buyer_name} · ` : ''}
                      Created {invoice.created_at ? formatDate(invoice.created_at) : ''}
                      {invoice.created_by_name ? ` by ${invoice.created_by_name}` : ' automatically at approval'}
                    </span>
                  </span>
                  <span className="ml-auto text-[13px] tabular-nums text-foreground">
                    {money(invoice.totals.total)}
                  </span>
                  <span aria-hidden className="text-[11px] text-muted-foreground">{open ? '▲' : '▼'}</span>
                </button>
                </div>

                {open && (
                  <div className="border-t border-[var(--led-line)] px-3 py-3 space-y-4">
                    {/* Mostly warnings — negative equity and a high LVR describe
                        deals the desk may still have good reason to write. The
                        arithmetic failures repeat in `blockers`, which gates. */}
                    {invoice.alerts.length > 0 && (
                      <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 space-y-1.5">
                        {invoice.alerts.map((alert) => (
                          <div key={alert.code} className="flex gap-2 text-[12.5px] text-foreground">
                            <span aria-hidden className="text-danger">▲</span>
                            <span>{alert.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {!invoice.totals.is_tax_invoice && !isRequest && (
                      <p className="rounded-md bg-secondary px-2.5 py-2 text-[12px] text-muted-foreground">
                        {isPrivate
                          ? 'Only a seller with an active ABN registered for GST can issue a tax invoice. Until ABN Lookup shows that, this is a standard invoice with no GST.'
                          : 'This supplier is not registered for GST, so the document is issued as an invoice rather than a tax invoice and shows no GST.'}
                      </p>
                    )}

                    <Section title={isRequest ? 'Request' : 'Invoice'}>
                      <Text label={isRequest ? 'Reference' : 'Invoice number'} value={field(invoice, 'invoice_number')} onChange={(v) => set('invoice_number', v)} disabled={locked} />
                      <Text label={isRequest ? 'Date' : 'Invoice date'} type="date" value={field(invoice, 'invoice_date')} onChange={(v) => set('invoice_date', v)} disabled={locked} />
                      {isRequest && (
                        <>
                          <Text label="Attention" value={field(invoice, 'attention')} onChange={(v) => set('attention', v)} disabled={locked} />
                          <Text label="Fax number" value={field(invoice, 'fax_number')} onChange={(v) => set('fax_number', v)} disabled={locked} />
                          <Text label="Dealer emails the invoice back to (broker & admin)" value={field(invoice, 'reply_to_email')} onChange={(v) => set('reply_to_email', v)} disabled={locked} />
                          <Choice
                            label="Facility"
                            value={String(field(invoice, 'facility_type'))}
                            options={[['', '—'], ...(Object.entries(FACILITY_LABEL) as [string, string][])]}
                            onChange={(v) => set('facility_type', v || null)}
                            disabled={locked}
                          />
                        </>
                      )}
                    </Section>

                    <Section title={isRequest ? 'Dealer' : isPrivate ? 'Seller — issues the invoice' : 'Supplier'}>
                      <Text label="Name" value={field(invoice, 'supplier_name')} onChange={(v) => set('supplier_name', v)} disabled={locked} />
                      <Text label="ABN" value={field(invoice, 'supplier_abn')} onChange={(v) => set('supplier_abn', v)} disabled={locked} />
                      {isPrivate && (
                        <Text label="ACN" value={field(invoice, 'supplier_acn')} onChange={(v) => set('supplier_acn', v)} disabled={locked} />
                      )}
                      {/* The seller is whoever the payout letter names, else the
                          registered owner — offer that name when it differs. */}
                      {isPrivate && !locked && invoice.expected_seller_name
                        && invoice.expected_seller_name !== field(invoice, 'supplier_name') && (
                        <button
                          type="button"
                          onClick={() => set('supplier_name', invoice.expected_seller_name)}
                          className="text-left text-[12px] text-primary hover:underline sm:col-span-2 lg:col-span-3"
                        >
                          Use <strong>{invoice.expected_seller_name}</strong> — the name on the{' '}
                          {invoice.totals.asset_payout > 0 && invoice.payout_letter_name ? 'payout letter' : 'registration certificate'}
                        </button>
                      )}
                      {isPrivate && (
                        <AbnCheck
                          invoice={invoice}
                          status={(field(invoice, 'supplier_abn_status') || null) as AbnStatus | null}
                          onCheck={() => checkAbn(invoice)}
                          onStatus={(v) => set('supplier_abn_status', v)}
                          busy={saving}
                          disabled={locked}
                        />
                      )}
                      <Text label="Address" value={field(invoice, 'supplier_address')} onChange={(v) => set('supplier_address', v)} disabled={locked} />
                      <Text label="Email" value={field(invoice, 'supplier_email')} onChange={(v) => set('supplier_email', v)} disabled={locked} />
                      <Text label="Phone" value={field(invoice, 'supplier_phone')} onChange={(v) => set('supplier_phone', v)} disabled={locked} />
                      {/* Private sales only — a dealer or auction house is always
                          treated as GST-registered. Even then GST follows ABN
                          Lookup; the flag is only the broker's to set when the
                          status was recorded by hand. */}
                      {isPrivate && field(invoice, 'supplier_abn_status') === 'active' && !invoice.supplier_abn_checked_at && (
                        <Check
                          label="Registered for GST"
                          checked={Boolean(draft.supplier_gst_registered ?? invoice.supplier_gst_registered)}
                          onChange={(v) => set('supplier_gst_registered', v)}
                          disabled={locked}
                        />
                      )}
                      {isPrivate && (
                        <Check
                          label="No ABN — 'statement by a supplier' held on file"
                          checked={Boolean(draft.abn_withholding_declared ?? invoice.abn_withholding_declared)}
                          onChange={(v) => set('abn_withholding_declared', v)}
                          disabled={locked}
                        />
                      )}
                    </Section>

                    {lenderBuys && (
                      <Section title="Sold to — the lender">
                        <p className="text-[12.5px] text-foreground sm:col-span-2 lg:col-span-3">
                          On a {FACILITY_LABEL[facility!].toLowerCase()} the lender buys the goods, so the dealer
                          invoices{' '}
                          <strong>{lenderName(invoice, lenderBook, field(invoice, 'lender_id')) || 'the financier chosen under Amounts'}</strong>
                          {invoice.lender_address && String(field(invoice, 'lender_id')) === invoice.lender_id
                            ? <>, {invoice.lender_address.replace(/\n/g, ', ')}</>
                            : null}
                          . The address comes from the lender book.
                        </p>
                      </Section>
                    )}

                    <Section title={
                      lenderBuys
                        ? 'Delivery to — the client'
                        : isPrivate
                          ? 'Addressed to — the client'
                          : `${isRequest ? 'Sold to — the client' : 'Buyer'}${invoice.totals.buyer_identity_required ? ' (required at $1,000 or more)' : ''}`
                    }>
                      {isRequest && facility === 'chattel' && (
                        <p className="text-[12px] text-muted-foreground sm:col-span-2 lg:col-span-3">
                          Chattel mortgage: the client's name, address, ABN and ACN print on both Sold To and Delivery To.
                        </p>
                      )}
                      {/* Always the application's applicant — the server keeps a
                          draft in step with it, so these are not edited here. */}
                      {!locked && (
                        <p className="text-[12px] text-muted-foreground sm:col-span-2 lg:col-span-3">
                          The application's applicant. To change who this is, edit the applicant on the application.
                        </p>
                      )}
                      <Text label="Name" value={invoice.buyer_name ?? ''} onChange={() => {}} disabled />
                      <Text label="ABN" value={invoice.buyer_abn ?? ''} onChange={() => {}} disabled />
                      <Text label="ACN" value={invoice.buyer_acn ?? ''} onChange={() => {}} disabled />
                      <Text label="Address" value={invoice.buyer_address ?? ''} onChange={() => {}} disabled />
                    </Section>

                    {(isRequest || isPrivate) && (
                      <Section title={lenderBuys ? 'Deliver somewhere else' : 'Delivery to'}>
                        <Check
                          label={lenderBuys || isPrivate ? 'Deliver to the client, as above' : 'Same as sold to'}
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

                    {isPrivate && (
                      <Section title="Seller paperwork">
                        <Choice label="Is a valuation needed?" value={yesNoValue(field(invoice, 'valuation_needed'))} options={YES_NO} onChange={(v) => set('valuation_needed', yesNoParse(v))} disabled={locked} />
                        <Choice label="Is there a charge on the PPSR?" value={yesNoValue(field(invoice, 'ppsr_charge'))} options={YES_NO} onChange={(v) => set('ppsr_charge', yesNoParse(v))} disabled={locked} />
                        {field(invoice, 'ppsr_charge') === true && (
                          <Choice label="Is it an ALL PAP charge?" value={yesNoValue(field(invoice, 'ppsr_all_pap'))} options={YES_NO} onChange={(v) => set('ppsr_all_pap', yesNoParse(v))} disabled={locked} />
                        )}
                        <Text label="Seller's name on the payout letter (if under finance)" value={field(invoice, 'payout_letter_name')} onChange={(v) => set('payout_letter_name', v)} disabled={locked} />
                        <Text label="Registered owner on the registration certificate" value={field(invoice, 'registration_name')} onChange={(v) => set('registration_name', v)} disabled={locked} />
                        <div className="sm:col-span-2 lg:col-span-3 rounded-md border border-[var(--led-line)] px-3 py-2">
                          <p className="text-[11.5px] text-muted-foreground mb-1.5">
                            Received from the seller. What is required follows the answers above and the payout under Amounts.
                          </p>
                          {invoice.seller_checklist.map((doc) => (
                            <label key={doc.key} className={`flex items-center gap-2 py-0.5 ${doc.required ? '' : 'opacity-50'}`}>
                              <input
                                type="checkbox"
                                checked={docReceived(doc.key, doc.received)}
                                onChange={(e) => setDocDraft((prev) => ({ ...prev, [doc.key]: e.target.checked }))}
                                disabled={locked}
                              />
                              <span className="text-[13px] text-foreground">{doc.label}</span>
                              <span className="text-[11.5px] text-muted-foreground">{doc.required ? 'required' : 'not needed'}</span>
                            </label>
                          ))}
                        </div>
                        {field(invoice, 'valuation_needed') === true && (
                          <>
                            <Text label="Valuation — market value (incl. GST)" type="number" value={field(invoice, 'valuation_market_value')} onChange={(v) => set('valuation_market_value', v === '' ? null : Number(v))} disabled={locked} />
                            <Text label="Valuation — forced sale value" type="number" value={field(invoice, 'valuation_forced_sale_value')} onChange={(v) => set('valuation_forced_sale_value', v === '' ? null : Number(v))} disabled={locked} />
                            <Text label="Valuer" value={field(invoice, 'valuer_name')} onChange={(v) => set('valuer_name', v)} disabled={locked} />
                            <Text label="Effective date of valuation" type="date" value={field(invoice, 'valuation_date')} onChange={(v) => set('valuation_date', v || null)} disabled={locked} />
                          </>
                        )}
                      </Section>
                    )}

                    <Section title={isRequest ? 'Vehicle details — from the contract of sale, or leave blank for the dealer' : 'Asset'}>
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
                        options={[['', '—'], ['new', 'New'], ['demo', 'Demo'], ['used', 'Used']]}
                        onChange={(v) => set('asset_condition', v || null)}
                        disabled={locked}
                      />
                      {/* The odometer decides this on prefill; say so, so a broker
                          who overrides it knows they are overriding something. */}
                      {odometerSuggestion && odometerSuggestion !== field(invoice, 'asset_condition') && !locked && (
                        <button
                          type="button"
                          onClick={() => set('asset_condition', odometerSuggestion)}
                          className="text-left text-[12px] text-primary hover:underline"
                        >
                          {Number(field(invoice, 'asset_odometer')).toLocaleString('en-AU')} km reads as{' '}
                          <strong>{CONDITION_LABEL[odometerSuggestion]}</strong> — apply
                        </button>
                      )}
                      <Text label="Engine number" value={field(invoice, 'asset_engine_number')} onChange={(v) => set('asset_engine_number', v)} disabled={locked} />
                      <Text label="Build date" value={field(invoice, 'asset_build_date')} onChange={(v) => set('asset_build_date', v)} disabled={locked} />
                      <Text label="Compliance date" value={field(invoice, 'asset_compliance_date')} onChange={(v) => set('asset_compliance_date', v)} disabled={locked} />
                      <Text label="Colour" value={field(invoice, 'asset_colour')} onChange={(v) => set('asset_colour', v)} disabled={locked} />
                      <Text label="Registration expiry" value={field(invoice, 'asset_registration_expiry')} onChange={(v) => set('asset_registration_expiry', v)} disabled={locked} />
                    </Section>

                    <Section title="Amounts">
                      {/* The financier and the four figures below come from the
                          lender pricing this deal was approved on. */}
                      <Choice
                        label="Financier (from the lender pricing)"
                        value={String(field(invoice, 'lender_id') ?? '')}
                        options={[
                          ['', '—'],
                          // A lender the book no longer offers still has to show.
                          ...(invoice.lender_id && !lenderBook.some((l) => l.id === invoice.lender_id)
                            ? ([[invoice.lender_id, `${invoice.lender_name ?? 'Unknown lender'} (no longer listed)`]] as [string, string][])
                            : []),
                          ...lenderBook.map((l) => [l.id, l.name] as [string, string]),
                        ]}
                        onChange={(v) => set('lender_id', v || null)}
                        disabled={locked}
                      />
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => refreshPricing(invoice)}
                          disabled={saving}
                          className="text-left text-[12px] text-primary hover:underline disabled:opacity-60"
                        >
                          Pull the facility, sale price, deposit, trade-in and payout from the latest lender pricing
                        </button>
                      )}
                      <Text label="Sale price" type="number" value={field(invoice, 'sale_price')} onChange={(v) => set('sale_price', v === '' ? null : Number(v))} disabled={locked} />
                      {invoice.supplier_type === 'auction' && (
                        <Text label="Buyer's premium" type="number" value={field(invoice, 'buyers_premium')} onChange={(v) => set('buyers_premium', v === '' ? null : Number(v))} disabled={locked} />
                      )}
                      <Text label="Other charges" type="number" value={field(invoice, 'other_charges')} onChange={(v) => set('other_charges', v === '' ? null : Number(v))} disabled={locked} />
                      <Text label="Other charges — label" value={field(invoice, 'other_charges_label')} onChange={(v) => set('other_charges_label', v)} disabled={locked} />
                      <Text label="Less trade in" type="number" value={field(invoice, 'trade_in_value')} onChange={(v) => set('trade_in_value', v === '' ? null : Number(v))} disabled={locked} />
                      {/* Two debts, opposite directions. What is owing on the
                          trade-in is added — the dealer clears it for the buyer.
                          What is owing on the asset being bought is already
                          inside its price and comes out of settlement. */}
                      <Text label="Payout owing on the trade-in" type="number" value={field(invoice, 'payout_amount')} onChange={(v) => set('payout_amount', v === '' ? null : Number(v))} disabled={locked} />
                      {/* Private sales only — a dealer or auction house sells the
                          asset clear of finance. */}
                      {isPrivate && (
                        <Text label="Payout owing on the asset being bought (paid to the seller's lender)" type="number" value={field(invoice, 'asset_payout_amount')} onChange={(v) => set('asset_payout_amount', v === '' ? null : Number(v))} disabled={locked} />
                      )}
                      {isPrivate && hasPayout && (
                        <Check
                          label="Seller reduced the payout to fit the funding (proof of payment required)"
                          checked={Boolean(draft.payout_reduced ?? invoice.payout_reduced)}
                          onChange={(v) => set('payout_reduced', v)}
                          disabled={locked}
                        />
                      )}
                      <Text label="Less cash deposit" type="number" value={field(invoice, 'deposit_paid')} onChange={(v) => set('deposit_paid', v === '' ? null : Number(v))} disabled={locked} />
                    </Section>

                    <Section title={hasPayout ? 'Part payment 2 — pay the seller' : 'Pay the supplier'}>
                      <Text label="Account name" value={field(invoice, 'payout_account_name')} onChange={(v) => set('payout_account_name', v)} disabled={locked} />
                      <Text label="BSB" value={field(invoice, 'payout_bsb')} onChange={(v) => set('payout_bsb', v)} disabled={locked} />
                      <Text label="Account number" value={field(invoice, 'payout_account_number')} onChange={(v) => set('payout_account_number', v)} disabled={locked} />
                    </Section>

                    {/* Only asked for once there is a payout to send: with the
                        asset owned outright there is no second payee. */}
                    {hasPayout && (
                      <Section title="Part payment 1 — pay out the existing finance">
                        <p className="text-[12px] text-muted-foreground">
                          The payout owing on the asset goes straight to the seller's financier so
                          it clears at settlement, and only the balance reaches the seller.
                        </p>
                        <Text label="Financier" value={field(invoice, 'payout_creditor_name')} onChange={(v) => set('payout_creditor_name', v)} disabled={locked} />
                        <Text label="BSB" value={field(invoice, 'payout_creditor_bsb')} onChange={(v) => set('payout_creditor_bsb', v)} disabled={locked} />
                        <Text label="Account number" value={field(invoice, 'payout_creditor_account_number')} onChange={(v) => set('payout_creditor_account_number', v)} disabled={locked} />
                      </Section>
                    )}

                    {/* Private sales only, and only when the broker says the check
                        is required. Not printed on the document — these exist
                        only so the names can be compared before money moves. */}
                    {isPrivate && (
                      <Section title="Identification check">
                        <Choice
                          label="Identification check"
                          value={yesNoValue(field(invoice, 'identity_check_required'))}
                          options={[['', 'Not answered'], ['yes', 'Required'], ['no', 'Not required']]}
                          onChange={(v) => set('identity_check_required', yesNoParse(v))}
                          disabled={locked}
                        />
                        {field(invoice, 'identity_check_required') === true && (
                          <>
                            <p className="text-[12px] text-muted-foreground sm:col-span-2 lg:col-span-3">
                              The seller's name as it appears on each document. Not printed — used to
                              confirm one person owns the asset and is being paid.
                            </p>
                            <Text label="Name on driver licence" value={field(invoice, 'licence_name')} onChange={(v) => set('licence_name', v)} disabled={locked} />
                            <Text label="Name on registration" value={field(invoice, 'registration_name')} onChange={(v) => set('registration_name', v)} disabled={locked} />
                            {invoice.name_match && <NameMatchTable match={invoice.name_match} />}
                          </>
                        )}
                      </Section>
                    )}

                    {/* What comes back on the dealer's own tax invoice. The request
                        prints these blank so the dealer fills them in. */}
                    {isRequest && invoice.dealer_to_supply.length > 0 && (
                      <div className="rounded-md border border-[var(--led-line)] px-3 py-2">
                        <p className="text-[12px] font-medium text-foreground mb-1">The dealer supplies on their tax invoice</p>
                        <p className="text-[12px] text-muted-foreground">{invoice.dealer_to_supply.join(' · ')}</p>
                      </div>
                    )}

                    <div className="rounded-md bg-secondary px-3 py-2 text-[12.5px] tabular-nums">
                      <Row label={isRequest ? 'Cash price' : 'Subtotal'} value={money(invoice.totals.subtotal)} />
                      {/* A dealer shows the GST on their own invoice — not worked out here. */}
                      {!isRequest && (
                        <Row label={invoice.totals.is_tax_invoice ? 'GST included' : 'GST'} value={money(invoice.totals.gst)} />
                      )}
                      {invoice.totals.trade_in > 0 && <Row label="Less trade in" value={money(invoice.totals.trade_in)} />}
                      {invoice.totals.payout > 0 && <Row label="Payout owing on the trade in" value={money(invoice.totals.payout)} />}
                      <Row label={isRequest ? 'Less cash deposit' : 'Deposit paid'} value={money(invoice.totals.deposit_paid)} />
                      <Row label={isRequest ? 'Total payable for goods' : isPrivate ? 'Amount funded' : 'Balance due'} value={money(invoice.totals.balance_due)} strong />
                      {/* The deposit is already out of the line above, so this is
                          that same figure under the lender's name for it. */}
                      <Row label="Amount financed" value={money(invoice.totals.amount_financed)} />
                      {!isRequest && <Row label="Ex GST" value={money(invoice.totals.ex_gst)} />}
                      {invoice.totals.lvr != null && (
                        <Row
                          label={invoice.totals.lvr_basis === 'valuation' ? 'LVR (against valuation)' : 'LVR (against cash price)'}
                          value={`${invoice.totals.lvr.toFixed(1)}%`}
                        />
                      )}
                      {invoice.totals.negative_equity > 0 && (
                        <Row label="Negative equity" value={money(invoice.totals.negative_equity)} />
                      )}
                    </div>

                    {/* How the one payable figure reaches two payees. Shown only
                        when there is a payout to carve out of it. */}
                    {hasPayout && (
                      <div className="rounded-md bg-secondary px-3 py-2 text-[12.5px] tabular-nums">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Settlement</p>
                        <Row
                          label={`Part payment 1 — ${invoice.payout_creditor_name || "seller's lender"}`}
                          value={money(invoice.totals.settlement_to_creditor)}
                        />
                        <Row
                          label={`Part payment 2 — ${invoice.payout_account_name || (isRequest ? 'dealer' : 'seller')}`}
                          value={money(invoice.totals.settlement_to_seller)}
                        />
                        <Row
                          label={invoice.totals.settlement_balances ? 'Reconciles to total payable' : 'Does not reconcile'}
                          value={money(invoice.totals.settlement_total)}
                          strong
                        />
                      </div>
                    )}

                    {invoice.blockers.length > 0 && !locked && (
                      <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
                        <p className="text-[12px] font-medium text-foreground mb-1">These figures do not reconcile</p>
                        <ul className="text-[12px] text-muted-foreground list-disc pl-4 space-y-0.5">
                          {invoice.blockers.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                      </div>
                    )}

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
                          <Button type="button" onClick={() => save(invoice)} disabled={saving || !dirty}>
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
                      {locked && (
                        <Button type="button" variant="secondary" onClick={() => email(invoice)} disabled={emailing === invoice.id}>
                          {emailing === invoice.id ? 'Sending…' : invoice.emailed_at ? 'Resend to broker & admin' : 'Email to broker & admin'}
                        </Button>
                      )}
                      {locked && invoice.issued_at && (
                        <span className="text-[12px] text-muted-foreground">
                          Issued {formatDate(invoice.issued_at)}
                          {invoice.emailed_at && ` · emailed ${formatDate(invoice.emailed_at)}`}
                        </span>
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

/** Supplier types with more than one draft — almost always a mis-click. */
function duplicateDrafts(invoices: TaxInvoice[]): [SupplierType, number][] {
  const counts = new Map<SupplierType, number>();
  for (const i of invoices) {
    if (i.status === 'draft') counts.set(i.supplier_type, (counts.get(i.supplier_type) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1);
}

/** Pick a type, then confirm. Where a draft of that type is already on the
 *  deal, opening it is the default and creating another is the deliberate
 *  second choice — a deal buying two assets does need two. */
function NewInvoiceChooser({
  invoices, picked, creating, onPick, onCreate, onOpen, onCancel,
}: {
  invoices: TaxInvoice[];
  picked: SupplierType | null;
  creating: boolean;
  onPick: (t: SupplierType) => void;
  onCreate: (t: SupplierType) => void;
  onOpen: (id: string) => void;
  onCancel: () => void;
}) {
  const existing = picked ? invoices.filter((i) => i.supplier_type === picked && i.status === 'draft') : [];
  return (
    <div className="mb-3 rounded-lg border border-[var(--led-line)] p-3">
      <p className="text-[12.5px] font-medium text-foreground mb-2">Who is the asset bought from?</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(SUPPLIER_LABEL) as SupplierType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className={`rounded-md border px-3 py-2 text-left ${picked === t ? 'border-primary bg-primary/5' : 'border-[var(--led-line)] hover:bg-secondary'}`}
          >
            <span className="block text-[13px] font-medium text-foreground">{SUPPLIER_LABEL[t]}</span>
            <span className="block text-[11.5px] text-muted-foreground">{SUPPLIER_HELP[t]}</span>
          </button>
        ))}
      </div>
      {existing.length > 0 && (
        <p className="mt-2 text-[12.5px] text-foreground">
          This deal already has {existing.length === 1 ? 'a' : existing.length} {SUPPLIER_LABEL[picked!].toLowerCase()} draft
          {existing.length > 1 ? 's' : ''}. Open {existing.length === 1 ? 'it' : 'the latest'} instead of starting another?
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {existing.length > 0 ? (
          <>
            <Button type="button" onClick={() => onOpen(existing[0].id)}>Open existing draft</Button>
            <Button type="button" variant="secondary" onClick={() => onCreate(picked!)} disabled={creating}>
              {creating ? 'Creating…' : 'Create another (second asset)'}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => picked && onCreate(picked)} disabled={!picked || creating}>
            {creating ? 'Creating…' : picked ? `Create ${SUPPLIER_LABEL[picked].toLowerCase()} invoice` : 'Choose one above'}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** The seller's ABN verdict: the ABN Lookup button, what it found, and a
 *  hand-set fallback for a seller with no ABN or when ABN Lookup is down. */
function AbnCheck({
  invoice, status, onCheck, onStatus, busy, disabled,
}: {
  invoice: TaxInvoice;
  status: AbnStatus | null;
  onCheck: () => void;
  onStatus: (v: AbnStatus | null) => void;
  busy: boolean;
  disabled: boolean;
}) {
  const verdict = !status
    ? 'Not checked yet'
    : status === 'active'
      ? `Active · ${invoice.supplier_gst_registered ? 'registered for GST — tax invoice' : 'not registered for GST — standard invoice'}`
      : `${ABN_STATUS_LABEL[status]} — GST-free, standard invoice`;
  return (
    <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-end gap-3 rounded-md bg-secondary px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] text-muted-foreground">ABN Lookup</p>
        <p className="text-[13px] text-foreground">
          {verdict}
          {invoice.supplier_abn_name && status === invoice.supplier_abn_status && (
            <span className="text-muted-foreground"> · registered to {invoice.supplier_abn_name}</span>
          )}
        </p>
        {invoice.supplier_abn_checked_at && status === invoice.supplier_abn_status && (
          <p className="text-[11.5px] text-muted-foreground">Checked {formatDate(invoice.supplier_abn_checked_at)}</p>
        )}
      </div>
      {!disabled && (
        <>
          <Button type="button" variant="secondary" onClick={onCheck} disabled={busy}>Check on ABN Lookup</Button>
          <label className="block">
            <span className="block text-[11.5px] text-muted-foreground mb-1">Or record by hand</span>
            <select
              value={status ?? ''}
              onChange={(e) => onStatus((e.target.value || null) as AbnStatus | null)}
              className="rounded-md border border-[var(--led-line)] bg-background px-2.5 py-1.5 text-[13px] text-foreground"
            >
              <option value="">—</option>
              {(Object.keys(ABN_STATUS_LABEL) as AbnStatus[]).map((k) => <option key={k} value={k}>{ABN_STATUS_LABEL[k]}</option>)}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

/** The four-way name check, shown as what agreed and what did not. Names left
 *  blank read as "not on file" rather than as a pass — an unchecked document
 *  proves nothing and should not look like it did. */
function NameMatchTable({ match }: { match: NonNullable<TaxInvoice['name_match']> }) {
  const rows: [string, string][] = [
    ...match.checked.map((label): [string, string] =>
      [label, match.mismatched.includes(label) ? 'Mismatch' : 'Match']),
    ...match.missing.map((label): [string, string] => [label, 'Not on file']),
  ];
  return (
    <div className="sm:col-span-2 lg:col-span-3 rounded-md bg-secondary px-3 py-2 text-[12px]">
      {rows.map(([label, verdict]) => (
        <div key={label} className="flex justify-between gap-3 py-0.5">
          <span className="text-muted-foreground">{label}</span>
          <span className={verdict === 'Mismatch' ? 'font-medium text-danger' : verdict === 'Match' ? 'text-foreground' : 'text-muted-foreground'}>
            {verdict}
          </span>
        </div>
      ))}
      <div className="mt-1 border-t border-[var(--led-line)] pt-1 flex justify-between gap-3">
        <span className="text-muted-foreground">Name match test</span>
        <span className={match.matches ? 'font-medium text-foreground' : 'font-medium text-danger'}>
          {match.matches ? 'Passed' : 'Failed'}
        </span>
      </div>
    </div>
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

/** Named so a dealer can file the attachment without opening it. A private
 *  sale follows the desk's naming: "Private sale (tax) invoice (Client).pdf". */
function pdfFilename(invoice: TaxInvoice): string {
  if (invoice.supplier_type === 'private') {
    // Strip only what a filesystem refuses; the name stays readable.
    const client = (invoice.buyer_name || 'client').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    return `${invoice.document_title} (${client}).pdf`;
  }
  const who = invoice.supplier_name || invoice.buyer_name || 'dealer';
  const stem = invoice.supplier_type === 'dealer' ? 'tax-invoice-request' : 'tax-invoice';
  const ref = invoice.invoice_number || who;
  return `${stem}-${ref}`.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase() + '.pdf';
}

/** The lender currently picked on the form, which may be an unsaved choice. */
function lenderName(invoice: TaxInvoice, book: Lender[], lenderId: string | number | boolean): string | null {
  if (!lenderId) return null;
  return book.find((l) => l.id === lenderId)?.name
    ?? (lenderId === invoice.lender_id ? invoice.lender_name : null);
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

/** Spread a server-derived party into PartyBlock's props. */
const partyProps = (p: TaxInvoiceParty) => ({ name: p.name, abn: p.abn, acn: p.acn, lines: [p.address] });

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
                  {/* A blank is a line for the dealer to write on, not a dash — the
                      request goes out for them to complete what we don't know. */}
                  {v || <span style={{ display: 'block', borderBottom: `1px dotted ${MUTED}`, height: 14 }} />}
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
      eyebrow={`Asset Finance · Dealer${invoice.facility_type ? ` · ${FACILITY_LABEL[invoice.facility_type]}` : ''}`}
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
          <PartyBlock heading="Sold to" {...partyProps(invoice.sold_to)} />
          <PartyBlock heading="Delivery to" {...partyProps(invoice.deliver_to)} />
        </div>
      </PrintSection>

      <PrintSection title="Full details of goods to be financed">
        {/* Row order is the request sheet's, top to bottom: the dealer's
            back-office reads down this list against their own stock card. */}
        <GoodsTable
          rows={[
            [['New or used', condition], ['Year', invoice.asset_year || '']],
            [['Make', invoice.asset_make || ''], ['Model (full details)', invoice.asset_model || invoice.asset_description || '']],
            [['VIN or chassis number', invoice.asset_vin || ''], ['Engine number', invoice.asset_engine_number || '']],
            [['Build and compliance date', buildCompliance], ['Odometer', invoice.asset_odometer != null ? `${invoice.asset_odometer.toLocaleString('en-AU')} km` : '']],
            [['Colour', invoice.asset_colour || ''], ['Registration details including expiry', rego]],
          ]}
        />
      </PrintSection>

      <PrintSection title="Full cost of goods">
        <div className="break-inside-avoid" style={{ marginLeft: 'auto', width: 330 }}>
          {/* The dealer releases the goods against a financier's settlement, so
              the sheet names which one is paying. */}
          {/* On a lease the lender is already Sold To; name it here only when
              the client is buying. */}
          {invoice.lender_name && !invoice.lender_owns_goods && <PrintRow label="Financier" value={invoice.lender_name} />}
          {/* The GST split is the dealer's to show on their invoice, not ours
              to calculate — hence the sheet's own wording. */}
          <PrintRow label="Cash price (please show GST)" value={money(invoice.sale_price)} />
          {invoice.other_charges != null && (
            <PrintRow label={invoice.other_charges_label || 'Other charges'} value={money(invoice.other_charges)} />
          )}
          <PrintRow label="Less trade in" value={money(t.trade_in)} />
          <PrintRow label="Payout owing on the trade in (if any)" value={money(t.payout)} />
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

      <SettlementSection invoice={invoice} />

      {invoice.notes && (
        <p className="break-inside-avoid" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
      )}
    </DocumentShell>
  );
}

/**
 * Where settlement money lands. One payee where the asset being bought is owned
 * outright, two where it carries finance: the payout clears the existing loan
 * and only the balance reaches the seller. Printing both parts is the point —
 * it is what stops the desk paying a seller in full and trusting them to clear
 * a debt secured over the very asset being bought.
 */
function SettlementSection({ invoice }: { invoice: TaxInvoice }) {
  const t = invoice.totals;
  const seller = [invoice.payout_account_name, invoice.payout_bsb, invoice.payout_account_number].filter(Boolean);
  const creditor = [invoice.payout_creditor_name, invoice.payout_creditor_bsb, invoice.payout_creditor_account_number].filter(Boolean);
  if (!seller.length && !creditor.length) return null;

  const account = (bsb: string | null, number: string | null) =>
    [bsb ? `BSB ${bsb}` : '', number ? `ACC ${number}` : ''].filter(Boolean).join('   ');

  if (t.asset_payout <= 0) {
    return (
      <PrintSection title="Nominated seller's account">
        <div className="break-inside-avoid">
          {invoice.payout_account_name && <div>{invoice.payout_account_name}</div>}
          <div>{account(invoice.payout_bsb, invoice.payout_account_number)}</div>
        </div>
      </PrintSection>
    );
  }

  return (
    <PrintSection title="Settlement — payable in two parts">
      <div className="break-inside-avoid">
        <div style={{ marginBottom: 6 }}>
          <PrintRow label={`Part payment 1 — ${invoice.payout_creditor_name || 'existing financier'}`} value={money(t.settlement_to_creditor)} />
          <div style={{ color: MUTED, fontSize: 10.5 }}>
            {account(invoice.payout_creditor_bsb, invoice.payout_creditor_account_number) || 'Account details to be confirmed'}
          </div>
        </div>
        <div>
          <PrintRow label={`Part payment 2 — ${invoice.payout_account_name || 'seller'}`} value={money(t.settlement_to_seller)} />
          <div style={{ color: MUTED, fontSize: 10.5 }}>
            {account(invoice.payout_bsb, invoice.payout_account_number) || 'Account details to be confirmed'}
          </div>
        </div>
        <PrintRow label="Total settlement" value={money(t.settlement_total)} strong />
      </div>
    </PrintSection>
  );
}

/**
 * The invoice this desk raises itself — a private seller or an auction house,
 * where there is no dealer to request a document from.
 */
function InvoiceDocument({ invoice }: { invoice: TaxInvoice }) {
  const t = invoice.totals;
  const heading = invoice.document_title.replace(/\b\w/g, (c) => c.toUpperCase());
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
          acn={invoice.supplier_acn}
          lines={[invoice.supplier_address, invoice.supplier_email, invoice.supplier_phone]}
        />
        <PartyBlock heading="To" {...partyProps(invoice.sold_to)} />
        {/* A private sale is addressed AND delivered to the client. */}
        {invoice.supplier_type === 'private' && <PartyBlock heading="Deliver to" {...partyProps(invoice.deliver_to)} />}
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
          {t.is_tax_invoice && <PrintRow label="Total excluding GST" value={money(t.ex_gst)} muted />}
          {t.trade_in > 0 && <PrintRow label="Less trade in" value={money(t.trade_in)} />}
          {t.payout > 0 && <PrintRow label="Payout owing on the trade in" value={money(t.payout)} />}
          {t.deposit_paid > 0 && <PrintRow label="Less deposit paid" value={money(t.deposit_paid)} />}
          <PrintRow label={invoice.supplier_type === 'private' ? 'Amount funded' : 'Balance due'} value={money(t.balance_due)} strong />
        </div>
      </PrintSection>

      {!t.is_tax_invoice && (
        <p className="break-inside-avoid" style={{ marginTop: 16, fontSize: 10.5, color: MUTED }}>
          The supplier is not registered for GST. No GST has been charged on this sale.
          {invoice.abn_withholding_declared && ' A statement by a supplier (no ABN) is held on file.'}
        </p>
      )}

      {/* A private sale is where the two-part settlement matters most: no dealer
          stands between the buyer and an encumbered asset. */}
      <SettlementSection invoice={invoice} />

      {invoice.notes && (
        <p className="break-inside-avoid" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
      )}
    </DocumentShell>
  );
}
