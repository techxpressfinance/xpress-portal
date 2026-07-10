import { useEffect, useState } from 'react';
import api from '../api/client';
import type { Contact, DuplicateConfidence, Organization } from '../types';

export interface DuplicateMatchView {
  id: string;
  title: string;
  detail: string;
  confidence: DuplicateConfidence;
  matchedOn: string[];
  url: string;
}

interface ContactCheckResponse {
  matches: { confidence: DuplicateConfidence; matched_on: string[]; contact: Contact }[];
}

interface OrganizationCheckResponse {
  matches: { confidence: DuplicateConfidence; matched_on: string[]; organization: Organization }[];
}

const DEBOUNCE_MS = 400;

function useDebouncedCheck(
  kind: 'contacts' | 'organizations',
  payload: Record<string, string | undefined>,
  enabled: boolean,
): DuplicateMatchView[] {
  const [matches, setMatches] = useState<DuplicateMatchView[]>([]);
  // String key: the payload object is rebuilt every render, but the effect
  // should only refire when the actual values change.
  const payloadKey = JSON.stringify(payload);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const body = JSON.parse(payloadKey);
      const request = kind === 'contacts'
        ? api.post<ContactCheckResponse>('/contacts/check-duplicates', body).then(({ data }) =>
            data.matches.map(m => ({
              id: m.contact.id,
              title: `${m.contact.first_name} ${m.contact.last_name}`,
              detail: [m.contact.email, m.contact.phone, m.contact.date_of_birth].filter(Boolean).join(' · '),
              confidence: m.confidence,
              matchedOn: m.matched_on,
              url: `/admin/contacts/${m.contact.id}`,
            })))
        : api.post<OrganizationCheckResponse>('/organizations/check-duplicates', body).then(({ data }) =>
            data.matches.map(m => ({
              id: m.organization.id,
              title: m.organization.name,
              detail: [m.organization.abn && `ABN ${m.organization.abn}`, m.organization.industry].filter(Boolean).join(' · '),
              confidence: m.confidence,
              matchedOn: m.matched_on,
              url: `/admin/companies/${m.organization.id}`,
            })));
      request
        .then(result => { if (!cancelled) setMatches(result); })
        .catch(() => { /* screening is best-effort; never block the form */ });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, payloadKey, enabled]);

  return enabled ? matches : [];
}

export function useContactDuplicateCheck(form: {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
}): DuplicateMatchView[] {
  const hasName = Boolean(form.first_name.trim() && form.last_name.trim());
  const hasIdentifier = Boolean(form.email?.trim() || form.phone?.trim());
  return useDebouncedCheck(
    'contacts',
    {
      first_name: form.first_name.trim() || undefined,
      last_name: form.last_name.trim() || undefined,
      email: form.email?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      date_of_birth: form.date_of_birth?.trim() || undefined,
    },
    hasName || hasIdentifier,
  );
}

export function useOrganizationDuplicateCheck(form: { name: string; abn?: string }): DuplicateMatchView[] {
  return useDebouncedCheck(
    'organizations',
    {
      name: form.name.trim() || undefined,
      abn: form.abn?.trim() || undefined,
    },
    form.name.trim().length >= 3 || (form.abn?.replace(/\D/g, '').length ?? 0) >= 11,
  );
}
