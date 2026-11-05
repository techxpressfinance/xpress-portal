import { useState } from 'react';
import {
  ASSET_IDENTIFIER_LABEL,
  ASSET_NOTES_PLACEHOLDER,
  VIN_LENGTH,
  assetIdentifierErrors,
  normaliseVin,
  type AssetIdentifier,
  type AssetIdentifierType,
} from '../lib/vin';

/**
 * How an asset is identified, wherever one is captured (application forms,
 * tax invoice, arrears): a 17-character VIN, or — for boats, trailers and
 * other assets without one — a serial / hull number plus required notes on
 * what the asset is and where it is coming from. Rules live in lib/vin.ts
 * (mirrored server-side in services/vin.py).
 *
 * Errors show once a field has been left, or for every field once the host
 * form sets `showErrors` (e.g. after a submit attempt).
 */
export default function AssetIdentifierFields({
  value,
  onChange,
  vinRequired = false,
  optional = false,
  disabled = false,
  showErrors = false,
  labelClassName = 'block text-[13px] font-medium text-[var(--led-ink-2)] mb-1.5',
  idPrefix = 'asset-id',
}: {
  value: AssetIdentifier;
  onChange: (next: AssetIdentifier) => void;
  /** A VIN must be given when the VIN option is chosen (arrears records). */
  vinRequired?: boolean;
  /** Mark the VIN as optional in its label (application forms). */
  optional?: boolean;
  disabled?: boolean;
  showErrors?: boolean;
  labelClassName?: string;
  idPrefix?: string;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errors = assetIdentifierErrors(value, { vinRequired });
  const shown = (key: keyof typeof errors) => ((showErrors || touched[key]) ? errors[key] : undefined);
  const touch = (key: string) => () => setTouched((t) => ({ ...t, [key]: true }));
  const set = (patch: Partial<AssetIdentifier>) => onChange({ ...value, ...patch });
  const pick = (t: AssetIdentifierType) => {
    if (t === value.identifier_type) return;
    // A fresh choice starts without the other option's leftover errors.
    setTouched({});
    set({ identifier_type: t });
  };
  const inputCls = (err?: string) =>
    `led-input w-full ${err ? '!border-[var(--led-danger)] !shadow-[0_0_0_3px_var(--led-danger-tint)]' : ''}`;
  const vinLen = value.vin.replace(/\s+/g, '').length;

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClassName}>Asset identifier</span>
        <div className="inline-flex rounded-lg border border-[var(--led-line)] p-0.5" role="radiogroup" aria-label="Asset identifier">
          {(Object.keys(ASSET_IDENTIFIER_LABEL) as AssetIdentifierType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={value.identifier_type === t}
              disabled={disabled}
              onClick={() => pick(t)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium disabled:opacity-60 ${
                value.identifier_type === t
                  ? 'bg-[var(--led-ink)] text-[var(--led-surface)]'
                  : 'text-[var(--led-muted)] hover:text-[var(--led-ink)]'
              }`}
            >
              {t === 'vin' ? 'VIN (17 characters)' : 'Serial / hull no.'}
            </button>
          ))}
        </div>
      </div>

      {value.identifier_type === 'vin' ? (
        <div>
          <label htmlFor={`${idPrefix}-vin`} className={labelClassName}>
            VIN {optional ? <span className="font-normal">(optional)</span> : vinRequired ? '*' : null}
          </label>
          <input
            id={`${idPrefix}-vin`}
            type="text"
            className={inputCls(shown('vin'))}
            placeholder="1HGCM82633A123456"
            value={value.vin}
            maxLength={VIN_LENGTH}
            disabled={disabled}
            onChange={(e) => set({ vin: normaliseVin(e.target.value) })}
            onBlur={touch('vin')}
            aria-invalid={Boolean(shown('vin'))}
          />
          {shown('vin') ? (
            <p role="alert" className="mt-1 text-[12px] font-medium text-[var(--led-danger)]">{shown('vin')}</p>
          ) : (
            <p className="mt-1 text-[11.5px] text-[var(--led-muted)]">
              {vinLen > 0 ? `${vinLen} / ${VIN_LENGTH} characters` : `Exactly ${VIN_LENGTH} characters. Boat, trailer or equipment? Choose Serial / hull no.`}
            </p>
          )}
        </div>
      ) : (
        <>
          <div>
            <label htmlFor={`${idPrefix}-serial`} className={labelClassName}>Serial / hull number *</label>
            <input
              id={`${idPrefix}-serial`}
              type="text"
              className={inputCls(shown('serial_number'))}
              placeholder="Hull ID, serial plate or engine number"
              value={value.serial_number}
              disabled={disabled}
              onChange={(e) => set({ serial_number: e.target.value })}
              onBlur={touch('serial_number')}
              aria-invalid={Boolean(shown('serial_number'))}
            />
            {shown('serial_number') && (
              <p role="alert" className="mt-1 text-[12px] font-medium text-[var(--led-danger)]">{shown('serial_number')}</p>
            )}
          </div>
          <div>
            <label htmlFor={`${idPrefix}-notes`} className={labelClassName}>Asset notes *</label>
            <textarea
              id={`${idPrefix}-notes`}
              className={`${inputCls(shown('identifier_notes'))} min-h-[64px] resize-y !h-auto py-2`}
              placeholder={ASSET_NOTES_PLACEHOLDER}
              value={value.identifier_notes}
              disabled={disabled}
              onChange={(e) => set({ identifier_notes: e.target.value })}
              onBlur={touch('identifier_notes')}
              aria-invalid={Boolean(shown('identifier_notes'))}
            />
            {shown('identifier_notes') ? (
              <p role="alert" className="mt-1 text-[12px] font-medium text-[var(--led-danger)]">{shown('identifier_notes')}</p>
            ) : (
              <p className="mt-1 text-[11.5px] text-[var(--led-muted)]">Say what the asset is and whether it is a private sale or from a dealer.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
