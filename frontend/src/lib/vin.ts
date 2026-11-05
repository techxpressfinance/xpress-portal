/**
 * Asset identifier rules shared by every field that holds one — mirrors
 * backend/app/services/vin.py.
 *
 * - VIN: exactly 17 characters (ISO 3779). Spaces are dropped, letters
 *   uppercased, typing stops at 17, and anything shorter is refused.
 * - Serial number: for boats, trailers, equipment and anything else without a
 *   VIN (hull numbers, serial plates). Any length, but it must come with asset
 *   notes saying what the asset is and where it is coming from (private sale
 *   or dealer).
 */
export const VIN_LENGTH = 17;

export type AssetIdentifierType = 'vin' | 'serial';

export const ASSET_IDENTIFIER_LABEL: Record<AssetIdentifierType, string> = {
  vin: 'VIN',
  serial: 'Serial / hull no.',
};

export const ASSET_NOTES_PLACEHOLDER =
  'What the asset is and where it is coming from — e.g. 2019 Quintrex 481 boat and trailer, private sale';

/** One VIN as it is typed: no spaces, uppercase, at most 17 characters. */
export const normaliseVin = (value: string): string =>
  value.replace(/\s+/g, '').toUpperCase().slice(0, VIN_LENGTH);

/** One VIN per line — a schedule line can cover several assets. Blank lines
 *  are kept while typing so Enter still starts the next VIN. */
export const normaliseVinLines = (value: string): string =>
  value.split('\n').map(normaliseVin).join('\n');

/** Why a typed VIN is not acceptable, or null (blank is not an error here). */
export const vinError = (value: string | null | undefined): string | null => {
  const v = (value ?? '').replace(/\s+/g, '');
  if (!v || v.length === VIN_LENGTH) return null;
  return `VIN must be exactly ${VIN_LENGTH} characters (${v.length} entered) — choose Serial number for an asset without a VIN`;
};

/** The VIN lines of a multi-asset field that are not 17 characters. */
export const vinLinesError = (value: string | null | undefined): string | null => {
  const bad = (value ?? '').split('\n').map((l) => l.replace(/\s+/g, '')).filter((l) => l && l.length !== VIN_LENGTH);
  if (!bad.length) return null;
  return `Each VIN must be exactly ${VIN_LENGTH} characters — ${bad.map((b) => `${b} (${b.length})`).join(', ')}. Put serial / hull numbers in their own field.`;
};

export interface AssetIdentifier {
  identifier_type: AssetIdentifierType;
  vin: string;
  serial_number: string;
  identifier_notes: string;
}

export const EMPTY_ASSET_IDENTIFIER: AssetIdentifier = {
  identifier_type: 'vin', vin: '', serial_number: '', identifier_notes: '',
};

export type AssetIdentifierErrors = Partial<Record<'vin' | 'serial_number' | 'identifier_notes', string>>;

export const ASSET_NOTES_REQUIRED =
  'Asset notes are required with a serial number — say what the asset is and where it is coming from (private sale or dealer)';

/** Every problem with an identifier. `vinRequired` makes a VIN mandatory when
 *  the VIN option is chosen (arrears records); otherwise a blank VIN is fine. */
export function assetIdentifierErrors(
  value: AssetIdentifier,
  { vinRequired = false }: { vinRequired?: boolean } = {},
): AssetIdentifierErrors {
  if (value.identifier_type === 'serial') {
    const errors: AssetIdentifierErrors = {};
    if (!value.serial_number.trim()) errors.serial_number = 'Serial / hull number is required';
    if (!value.identifier_notes.trim()) errors.identifier_notes = ASSET_NOTES_REQUIRED;
    return errors;
  }
  if (!value.vin.trim()) return vinRequired ? { vin: 'VIN is required — or choose Serial number for an asset without a VIN' } : {};
  const err = vinError(value.vin);
  return err ? { vin: err } : {};
}

/** Read an identifier off a stored record (application asset block, arrears
 *  row…). A record without a type is a VIN record. */
export function readAssetIdentifier(src: {
  identifier_type?: unknown; vin?: unknown; serial_number?: unknown; identifier_notes?: unknown;
} | null | undefined): AssetIdentifier {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    identifier_type: src?.identifier_type === 'serial' ? 'serial' : 'vin',
    vin: str(src?.vin),
    serial_number: str(src?.serial_number),
    identifier_notes: str(src?.identifier_notes),
  };
}

/** The identifier as stored: only the chosen option's fields are kept. */
export function assetIdentifierPayload(value: AssetIdentifier): AssetIdentifier {
  return value.identifier_type === 'serial'
    ? { identifier_type: 'serial', vin: '', serial_number: value.serial_number.trim(), identifier_notes: value.identifier_notes.trim() }
    : { identifier_type: 'vin', vin: value.vin, serial_number: '', identifier_notes: '' };
}

/** Label/value rows for showing a stored identifier read-only. */
export function assetIdentifierRows(src: Parameters<typeof readAssetIdentifier>[0]): [string, string][] {
  const id = readAssetIdentifier(src);
  if (id.identifier_type === 'serial') {
    return [
      ...(id.serial_number ? [['Serial / hull no.', id.serial_number] as [string, string]] : []),
      ...(id.identifier_notes ? [['Asset notes', id.identifier_notes] as [string, string]] : []),
    ];
  }
  return id.vin ? [['VIN', id.vin]] : [];
}

/** A stored identifier in one line — "VIN …" / "Serial …" — or null. */
export function assetIdentifierShort(src: Parameters<typeof readAssetIdentifier>[0]): string | null {
  const id = readAssetIdentifier(src);
  if (id.identifier_type === 'serial') return id.serial_number ? `Serial ${id.serial_number}` : null;
  return id.vin ? `VIN ${id.vin}` : null;
}
