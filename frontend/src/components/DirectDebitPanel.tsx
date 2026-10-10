import { useEffect, useMemo, useRef, useState } from 'react';
import { useAutosave } from '../lib/useAutosave';
import api from '../api/client';
import { useToast } from './Toast';
import { Button, Card, Input } from './ui';
import DirectDebitPrint, { type DirectDebitLender } from './print/DirectDebitPrint';
import { lenderLogoDataUrl } from '../lib/lenderLogo';
import { applicantCounterpart, applicantDisplayName, applicantName, isCompanyApplicant } from '../lib/applicantName';
import {
  buildDirectDebitStatement,
  parseDirectDebitSettings,
  pickPricingSheet,
  type DirectDebitSettings,
  type FeeRow,
  type StructuredRow,
} from '../lib/directDebit';
import { DIRECT_DEBIT_CYCLE_LABELS, fmtCurrency } from '../lib/lenderPricing';
import { downloadQuoteSheetPdf } from '../lib/pdfExport';
import { getErrorMessage } from '../lib/utils';
import type { Lender, LoanApplication, QuoteSheet } from '../types';

const PREVIEW_SCALE = 0.62;
const RENDER_ID = 'direct-debit-pdf-render';

const toNumber = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Who signs for the client: the applicant, or the director behind a company. */
function defaultSignatory(application: LoanApplication): string {
  if (isCompanyApplicant(application)) {
    const counterpart = applicantCounterpart(application);
    return counterpart?.kind === 'person' ? counterpart.name : '';
  }
  return applicantName(application);
}

/**
 * The direct debit first payment request for a settled deal. Figures come
 * from the lender pricing; the broker picks the structure, settlement date,
 * any fees the pricing doesn't carry and structured repayments, then prints
 * it on the lender's letterhead.
 */
export default function DirectDebitPanel({
  application,
  quoteSheets,
  onApplicationChange,
}: {
  application: LoanApplication;
  quoteSheets: QuoteSheet[];
  onApplicationChange: (app: LoanApplication) => void;
}) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DirectDebitSettings>(() => parseDirectDebitSettings(application));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [lender, setLender] = useState<DirectDebitLender | null>(null);

  const pricingSheets = quoteSheets.filter((s) => s.sheet_type === 'lender_pricing');
  const sheet = pickPricingSheet(quoteSheets, settings);
  const statement = useMemo(
    () => (sheet ? buildDirectDebitStatement(sheet, settings, application) : null),
    [sheet, settings, application],
  );

  // The letterhead: the lender book's name, ABN, address and logo. A lender a
  // broker can't open (retired) still prints under the name on the pricing.
  const lenderId = statement?.lenderId ?? null;
  const fallbackName = statement?.lenderName ?? '';
  useEffect(() => {
    let cancelled = false;
    if (!lenderId) {
      setLender({ name: fallbackName, abn: null, address: null, logo: null });
      return;
    }
    (async () => {
      let record: Lender | null = null;
      try {
        record = (await api.get<Lender>(`/lenders/${lenderId}`)).data;
      } catch { /* falls back to the pricing's lender name */ }
      const logo = record?.logo_filename ? await lenderLogoDataUrl(lenderId) : null;
      if (!cancelled) {
        setLender({ name: record?.name || fallbackName, abn: record?.abn ?? null, address: record?.address ?? null, logo });
      }
    })();
    return () => { cancelled = true; };
  }, [lenderId, fallbackName]);

  const update = (patch: Partial<DirectDebitSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };
  const setFees = (fees: FeeRow[]) => update({ fees });
  const setStructured = (rows: StructuredRow[]) => update({ structured: rows });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const save = async (quiet = false) => {
    const sent = settings;
    setSaving(true);
    try {
      const { data } = await api.put<LoanApplication>(`/applications/${application.id}/direct-debit-request`, { settings });
      onApplicationChange(data);
      // Edits made while the request was in flight stay pending.
      setDirty(settingsRef.current !== sent);
      setSavedAt(Date.now());
    } catch (err) {
      if (!quiet) toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  useAutosave(dirty, settings, () => save(true));

  const download = async () => {
    setDownloading(true);
    // Let the off-screen copy mount before it is captured.
    await new Promise((r) => setTimeout(r, 150));
    try {
      const ref = `APP-${application.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
      // The lender's document: no Xpress footer band.
      await downloadQuoteSheetPdf(RENDER_ID, `Direct-Debit-First-Payment-${ref}.pdf`, [0, 0, 0, 0], false);
    } catch {
      toast('Failed to generate PDF', 'error');
    } finally {
      setDownloading(false);
    }
  };

  if (!sheet || !statement) {
    return (
      <Card>
        <h2 className="text-[15px] font-semibold text-foreground">Direct debit first payment request</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Add lender pricing first — the first payment and the lender&rsquo;s fees are taken from it.
        </p>
      </Card>
    );
  }

  const clientName = applicantDisplayName(application, '—');
  const signatoryName = settings.signatory_name ?? defaultSignatory(application);
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const printProps = {
    statement,
    lender: lender ?? { name: fallbackName, abn: null, address: null, logo: null },
    clientName,
    signatoryName,
    today,
  };
  const cycleLabel = DIRECT_DEBIT_CYCLE_LABELS[statement.cycle].toLowerCase();

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Direct debit first payment request</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            On {statement.lenderName || 'the lender'}&rsquo;s letterhead. {statement.advance ? 'Advance' : 'Arrears'} payments, {cycleLabel} debits
            {statement.normalRepayment != null && <> — {fmtCurrency(statement.normalRepayment)} per {statement.cycleUnit}</>}.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="self-center text-[12px] text-muted-foreground">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? 'Autosaved ✓' : ''}
          </span>
          <Button size="sm" onClick={download} loading={downloading} disabled={downloading || !lender}>Download PDF</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-5">
          {pricingSheets.length > 1 && (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">Lender pricing</span>
              <select
                className="led-input w-full"
                value={sheet.id}
                onChange={(e) => update({ pricing_sheet_id: e.target.value })}
              >
                {[...pricingSheets].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((s) => (
                  <option key={s.id} value={s.id}>{s.title || s.lender_name || 'Lender pricing'} · v{s.version}</option>
                ))}
              </select>
            </label>
          )}

          {statement.hasBalloonOption && (
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">Structure written</span>
              <div className="flex gap-4 text-[13px]">
                {[[true, 'With balloon'], [false, 'No balloon']].map(([v, label]) => (
                  <label key={String(v)} className="flex items-center gap-2">
                    <input type="radio" checked={statement.withBalloon === v} onChange={() => update({ with_balloon: v as boolean })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <Input
              label="Settlement date"
              type="date"
              value={statement.settlementDate ?? ''}
              onChange={(e) => update({ settlement_date: e.target.value || null })}
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              {statement.advance
                ? `Advance: the first debit is on the day of settlement${statement.firstDebitDate ? ` — ${statement.firstDebitDate.split('-').reverse().join('/')}` : ''}.`
                : `Arrears: the first debit is one month after settlement${statement.firstDebitDate ? ` — ${statement.firstDebitDate.split('-').reverse().join('/')}` : ''}.`}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-[var(--led-ink-2)]">Fees on the first debit</p>
              <button
                type="button"
                className="text-[12.5px] font-medium text-primary hover:underline"
                onClick={() => setFees([...statement.feeRows, { label: '', amount: null }])}
              >
                + Add a fee
              </button>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {statement.allFeesFinanced
                ? 'Fees are financed in the loan — each one entered is shown as "Financed" and not added to the total.'
                : 'Fees are not financed — what you enter is added to the first debit only.'}
              {' '}Fees with no amount are left off the document.
            </p>
            {statement.feeRows.map((fee, i) => (
              <div key={i} className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={i === 0 ? 'Fee' : undefined}
                    placeholder="Fee name"
                    value={fee.label}
                    onChange={(e) => setFees(statement.feeRows.map((f, j) => (j === i ? { ...f, label: e.target.value } : f)))}
                  />
                </div>
                <div className="w-32">
                  <Input
                    label={i === 0 ? 'Amount' : undefined}
                    type="number"
                    step="0.01"
                    min="0"
                    value={fee.amount ?? ''}
                    onChange={(e) => setFees(statement.feeRows.map((f, j) => (j === i ? { ...f, amount: toNumber(e.target.value) } : f)))}
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setFees(statement.feeRows.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-[var(--led-ink-2)]">Structured repayments</p>
              <button
                type="button"
                className="text-[12.5px] font-medium text-primary hover:underline"
                onClick={() => setStructured([...settings.structured, { payment: null, amount: null }])}
              >
                + Add a payment
              </button>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Only for a structured contract. The amount is added to the normal repayment on that one {cycleLabel} payment — e.g. payment 4, 3,000 makes the 4th debit the normal repayment plus 3,000. Every other payment stays normal.
            </p>
            {settings.structured.map((row, i) => (
              <div key={i} className="mt-2 flex items-end gap-2">
                <div className="w-28">
                  <Input
                    label={i === 0 ? 'Payment no.' : undefined}
                    type="number"
                    min="1"
                    value={row.payment ?? ''}
                    onChange={(e) => setStructured(settings.structured.map((r, j) => (j === i ? { ...r, payment: toNumber(e.target.value) } : r)))}
                  />
                </div>
                <div className="flex-1">
                  <Input
                    label={i === 0 ? 'Extra amount' : undefined}
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.amount ?? ''}
                    onChange={(e) => setStructured(settings.structured.map((r, j) => (j === i ? { ...r, amount: toNumber(e.target.value) } : r)))}
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setStructured(settings.structured.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
          </div>

          <Input
            label="Signed by"
            value={signatoryName}
            onChange={(e) => update({ signatory_name: e.target.value })}
            placeholder="Client or director signing"
          />
        </div>

        {/* Live preview at a reduced scale. */}
        <div
          className="overflow-hidden rounded-lg border border-border bg-white shadow-sm"
          style={{ width: 794 * PREVIEW_SCALE, height: 1123 * PREVIEW_SCALE }}
        >
          <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
            <DirectDebitPrint {...printProps} />
          </div>
        </div>
      </div>

      {/* Unscaled copy for the PDF capture — a transformed parent distorts it. */}
      {downloading && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }}>
          <div id={RENDER_ID}>
            <DirectDebitPrint {...printProps} />
          </div>
        </div>
      )}
    </Card>
  );
}
