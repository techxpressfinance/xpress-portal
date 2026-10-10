import { useMemo, useRef, useState } from 'react';
import { useAutosave } from '../lib/useAutosave';
import api from '../api/client';
import { useToast } from './Toast';
import { Button, Card, Input } from './ui';
import SettlementDeclarationPrint, { type DeclarationKind } from './print/SettlementDeclarationPrint';
import {
  DEFAULT_PAYOFF_STRATEGY,
  buildDeclarations,
  parseDeclarationSettings,
  type DeclarationSettings,
} from '../lib/settlementDeclarations';
import { downloadQuoteSheetPdf } from '../lib/pdfExport';
import { getErrorMessage } from '../lib/utils';
import type { LoanApplication, QuoteSheet } from '../types';

const PREVIEW_SCALE = 0.62;
const RENDER_ID = 'settlement-declaration-pdf-render';
// Word's 1 inch top and bottom margins, in mm — on every page of the PDF.
const PAGE_MARGIN_MM = 25.4;

const DOCS: { kind: DeclarationKind; label: string; file: string }[] = [
  { kind: 'early_termination', label: 'Early termination', file: 'Early-Termination-Declaration' },
  { kind: 'balloon_payout', label: 'Balloon payout', file: 'Balloon-Payout-Declaration' },
];

/**
 * The declarations the client signs at settlement: early termination on every
 * deal, and the balloon payout declaration when the contract carries a balloon.
 * Term and balloon come from the lender pricing; the broker confirms the
 * application number, payoff strategy, the broker named and who signs.
 */
export default function SettlementDeclarationsPanel({
  application,
  quoteSheets,
  onApplicationChange,
}: {
  application: LoanApplication;
  quoteSheets: QuoteSheet[];
  onApplicationChange: (app: LoanApplication) => void;
}) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DeclarationSettings>(() => parseDeclarationSettings(application));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [viewing, setViewing] = useState<DeclarationKind>('early_termination');
  const [downloading, setDownloading] = useState<DeclarationKind | null>(null);

  const pricingSheets = quoteSheets.filter((s) => s.sheet_type === 'lender_pricing');
  const declarations = useMemo(
    () => buildDeclarations(quoteSheets, settings, application),
    [quoteSheets, settings, application],
  );

  const update = (patch: Partial<DeclarationSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const save = async (quiet = false) => {
    const sent = settings;
    setSaving(true);
    try {
      const { data } = await api.put<LoanApplication>(`/applications/${application.id}/settlement-declarations`, { settings });
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

  const download = async (kind: DeclarationKind) => {
    setDownloading(kind);
    // Let the off-screen copy mount before it is captured.
    await new Promise((r) => setTimeout(r, 150));
    try {
      const ref = `APP-${application.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
      const file = DOCS.find((d) => d.kind === kind)!.file;
      // The client's own declaration: no Xpress footer band.
      await downloadQuoteSheetPdf(RENDER_ID, `${file}-${ref}.pdf`, [PAGE_MARGIN_MM, 0, PAGE_MARGIN_MM, 0], false);
    } catch {
      toast('Failed to generate PDF', 'error');
    } finally {
      setDownloading(null);
    }
  };

  if (!declarations) {
    return (
      <Card>
        <h2 className="text-[15px] font-semibold text-foreground">Settlement declarations</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Add lender pricing first — the loan term and balloon are taken from it.
        </p>
      </Card>
    );
  }

  const docs = DOCS.filter((d) => d.kind === 'early_termination' || declarations.withBalloon);
  const shown: DeclarationKind = declarations.withBalloon ? viewing : 'early_termination';
  const setSignatories = (names: string[]) => update({ signatories: names });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Settlement declarations</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {declarations.term || 'Term not set'}, {declarations.withBalloon ? `${declarations.balloonLine} balloon` : 'no balloon'}.{' '}
            {declarations.withBalloon
              ? 'The client signs both declarations.'
              : 'No balloon on this contract, so only the early termination declaration applies.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-[12px] text-muted-foreground">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? 'Autosaved ✓' : ''}
          </span>
          {docs.map((d) => (
            <Button key={d.kind} size="sm" onClick={() => download(d.kind)} loading={downloading === d.kind} disabled={downloading != null}>
              {d.label} PDF
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-5">
          {pricingSheets.length > 1 && (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">Lender pricing</span>
              <select
                className="led-input w-full"
                value={declarations.sheet.id}
                onChange={(e) => update({ pricing_sheet_id: e.target.value })}
              >
                {[...pricingSheets].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((s) => (
                  <option key={s.id} value={s.id}>{s.title || s.lender_name || 'Lender pricing'} · v{s.version}</option>
                ))}
              </select>
            </label>
          )}

          {declarations.hasBalloonOption && (
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">Structure written</span>
              <div className="flex gap-4 text-[13px]">
                {[[true, 'With balloon'], [false, 'No balloon']].map(([v, label]) => (
                  <label key={String(v)} className="flex items-center gap-2">
                    <input type="radio" checked={declarations.withBalloon === v} onChange={() => update({ with_balloon: v as boolean })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <Input
            label="Application number"
            value={declarations.applicationNumber}
            onChange={(e) => update({ application_number: e.target.value })}
          />

          {declarations.withBalloon && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[var(--led-ink-2)]">Balloon payoff strategy</span>
                <textarea
                  className="led-input w-full"
                  rows={3}
                  value={declarations.payoffStrategy}
                  onChange={(e) => update({ payoff_strategy: e.target.value })}
                  placeholder={DEFAULT_PAYOFF_STRATEGY}
                />
              </label>
              <Input
                label="Broker named in the balloon declaration"
                value={settings.broker_name ?? declarations.brokerName}
                onChange={(e) => update({ broker_name: e.target.value })}
                placeholder="Broker's name"
              />
            </>
          )}

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-[var(--led-ink-2)]">Signed by</p>
              <button
                type="button"
                className="text-[12.5px] font-medium text-primary hover:underline"
                onClick={() => setSignatories([...declarations.signatories, ''])}
              >
                + Add a signer
              </button>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Each signer gets a name, signature and date block. Signature and date print empty for them to complete.
            </p>
            {declarations.signatories.map((name, i) => (
              <div key={i} className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    value={name}
                    onChange={(e) => setSignatories(declarations.signatories.map((n, j) => (j === i ? e.target.value : n)))}
                    placeholder="Name (leave blank to print an empty block)"
                  />
                </div>
                {declarations.signatories.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setSignatories(declarations.signatories.filter((_, j) => j !== i))}>Remove</Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          {docs.length > 1 && (
            <div className="mb-2 flex gap-1 text-[12.5px]">
              {docs.map((d) => (
                <button
                  key={d.kind}
                  type="button"
                  onClick={() => setViewing(d.kind)}
                  className={`rounded-md px-2.5 py-1 font-medium ${shown === d.kind ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          {/* Live preview at a reduced scale; a long declaration scrolls. */}
          <div
            className="overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-white shadow-sm"
            style={{ width: 794 * PREVIEW_SCALE, height: 1123 * PREVIEW_SCALE }}
          >
            <div style={{ zoom: PREVIEW_SCALE }}>
              <SettlementDeclarationPrint kind={shown} declarations={declarations} paddingY={96} />
            </div>
          </div>
        </div>
      </div>

      {/* Unscaled copy for the PDF capture — a scaled parent distorts it. */}
      {downloading && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0 }}>
          <div id={RENDER_ID}>
            <SettlementDeclarationPrint kind={downloading} declarations={declarations} />
          </div>
        </div>
      )}
    </Card>
  );
}
