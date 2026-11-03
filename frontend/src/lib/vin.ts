/**
 * VIN input rules shared by every field that holds one — mirrors
 * backend/app/services/vin.py. A VIN is 17 characters (ISO 3779): spaces are
 * dropped, letters uppercased, and typing stops at 17.
 */
export const VIN_LENGTH = 17;

/** One VIN as it is typed: no spaces, uppercase, at most 17 characters. */
export const normaliseVin = (value: string): string =>
  value.replace(/\s+/g, '').toUpperCase().slice(0, VIN_LENGTH);

/** One VIN per line — a schedule line can cover several assets. Blank lines
 *  are kept while typing so Enter still starts the next VIN. */
export const normaliseVinLines = (value: string): string =>
  value.split('\n').map(normaliseVin).join('\n');
