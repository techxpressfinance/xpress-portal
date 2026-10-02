import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { Button, Card, Input } from './ui';
import DirectDebitPrint, { type DirectDebitLender } from './print/DirectDebitPrint';
import { lenderLogoDataUrl } from '../lib/lenderLogo';
import { applicantCounterpart, applicantDisplayName, applicantName, isCompanyApplicant } from '../lib/applicantName';
import {
  CYCLE_PERIOD,
  buildDirectDebitStatement,
  parseDirectDebitSettings,
  pickPricingSheet,
  type DirectDebitSettings,
  type StructuredRow,
} from '../lib/directDebit';
import { DIRECT_DEBIT_CYCLE_LABELS, fmtCurrency } from '../lib/lenderPricing';
import { downloadQuoteSheetPdf } from '../lib/pdfExport';
import { getErrorMessage } from '../lib/utils';
import type { Lender, LoanApplication, QuoteSheet } from '../types';

const PREVIEW_SCALE = 0.62;
const RENDER_ID = 'direct-debit-pdf-render';

type FeeKey = 'vsr_fee' | 'private_sale_fee' | 'asic_fee' | 'stamp_duty';
const FEES: [FeeKey, string][] = [
  ['vsr_fee', 'VSR fee'],
  ['private_sale_fee', 'Private sale fee'],
  ['asic_fee', 'ASIC fee (312)'],
  ['stamp_duty', 'Stamp duty'],
];

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
  const setStructured = (rows: StructuredRow[]) => update({ structured: rows });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put<LoanApplication>(`/applications/${application.id}/direct-debit-request`, { settings });
      onApplicationChange(data);
      setDirty(false);
      toast('Direct debit request saved', 'success');
    } catch (err) {
      toast(getErrorMessage(err, 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  };

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
            {statement.repayment != null && <> — {fmtCurrency(statement.repayment)} per {statement.cycleUnit}</>}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={save} loading={saving} disabled={!dirty || saving}>Save</Button>
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
                ? 'Advance: the letter says the first debit comes a couple of days after settlement.'
                : `Arrears: the first debit is ${CYCLE_PERIOD[statement.cycle]} after settlement${statement.firstDebitDate ? ` — ${statement.firstDebitDate.split('-').reverse().join('/')}` : ''}.`}
            </p>
          </div>

          <div>
            <p className="text-[13px] font-medium text-[var(--led-ink-2)]">Lender&rsquo;s fees</p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {statement.feesFinanced
                ? 'Financed in the loan — shown as "Bank Fee - Financed" with nothing added.'
                : `Not financed — ${fmtCurrency(statement.lenderFees)} is added to the first debit.`}
            </p>
          </div>

          <div>
            <p className="mb-2 text-[13px] font-medium text-[var(--led-ink-2)]">Other amounts on the first debit</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {FEES.map(([key, label]) => (
                <Input
                  key={key}
                  label={label}
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings[key] ?? ''}
                  onChange={(e) => update({ [key]: toNumber(e.target.value) })}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-[var(--led-ink-2)]">Structured repayments</p>
              <button
                type="button"
                className="text-[12.5px] font-medium text-primary hover:underline"
                onClick={() => setStructured([...settings.structured, { count: null, amount: null }])}
              >
                + Add a run
              </button>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Only for a structured contract. Each run is a number of {cycleLabel} payments at one amount, in order; the first run&rsquo;s amount becomes the first payment.
            </p>
            {settings.structured.map((row, i) => (
              <div key={i} className="mt-2 flex items-end gap-2">
                <div className="w-28">
                  <Input
                    label={i === 0 ? 'Payments' : undefined}
                    type="number"
                    min="1"
                    value={row.count ?? ''}
                    onChange={(e) => setStructured(settings.structured.map((r, j) => (j === i ? { ...r, count: toNumber(e.target.value) } : r)))}
                  />
                </div>
                <div className="flex-1">
                  <Input
                    label={i === 0 ? 'Amount each' : undefined}
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
