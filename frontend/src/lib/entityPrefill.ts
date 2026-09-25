import { durationSince } from './utils';
import type { AbrRecord, EntitySearchResult } from '../types';

// The entity book's structure vocabulary, in the words the business-details
// section offers. `trustee` is a company in that vocabulary — what it is
// trustee of is the trust's own record. Mirrors ENTITY_TYPE_TO_STRUCTURE in
// backend/app/services/organizations.py.
export const ENTITY_TYPE_TO_STRUCTURE: Record<string, string> = {
  sole_trader: 'Sole Trader',
  partnership: 'Partnership',
  company: 'Company',
  trustee: 'Company',
  trust: 'Trust',
};

export function abrEntityTypeToStructure(entityType: string | null): string {
  const type = (entityType || '').toLowerCase();
  if (type.includes('trust')) return 'Trust';
  if (type.includes('partnership')) return 'Partnership';
  if (type.includes('company')) return 'Company';
  if (type.includes('individual') || type.includes('sole trader')) return 'Sole Trader';
  return '';
}

/** The business-section values a register record (or an entity synced from
 *  one) can answer. Empty strings / null mean "the register doesn't say" —
 *  callers only fill fields that are still blank. How long the ABN has been
 *  held is a floor on time trading, not the exact figure. */
export interface BusinessPrefill {
  trading_name: string;
  business_structure: string;
  business_registration_date: string;
  time_trading: string;
  gst_registered: boolean | null;
}

export function prefillFromEntity(en: EntitySearchResult): BusinessPrefill {
  return {
    trading_name: en.trading_names?.[0] || '',
    business_structure: ENTITY_TYPE_TO_STRUCTURE[en.entity_type || ''] || '',
    business_registration_date: en.abn_registered_from || '',
    time_trading: durationSince(en.abn_registered_from) || '',
    gst_registered: en.gst_registered ?? null,
  };
}

export function prefillFromAbr(record: AbrRecord): BusinessPrefill {
  return {
    trading_name: record.trading_names[0] || '',
    business_structure: abrEntityTypeToStructure(record.entity_type),
    business_registration_date: record.status_from || '',
    time_trading: durationSince(record.status_from) || '',
    gst_registered: record.gst_registered,
  };
}

/** Human labels for the prefill toast/hint: "trading name, GST registration…". */
export function prefillLabels(p: BusinessPrefill): string[] {
  return [
    p.trading_name ? 'trading name' : null,
    p.business_structure ? 'structure' : null,
    p.business_registration_date ? 'registration date' : null,
    p.time_trading ? 'time trading (from ABN age)' : null,
    p.gst_registered != null ? 'GST registration' : null,
  ].filter(Boolean) as string[];
}
