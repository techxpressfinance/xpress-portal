import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import type { TenantBranding } from '../types';

interface TenantState {
  tenant: TenantBranding | null;
  slug: string | null;
  loading: boolean;
  error: string | null;
}

const TenantContext = createContext<TenantState>({
  tenant: null,
  slug: null,
  loading: true,
  error: null,
});

export function useTenant() {
  return useContext(TenantContext);
}

function resolveSlug(): string | null {
  // 1. localStorage override (for local dev)
  const stored = localStorage.getItem('dev-tenant-slug');
  if (stored) return stored;

  // 2. Subdomain extraction: <slug>.localhost or <slug>.xpresstech.com
  const host = window.location.hostname;
  const parts = host.split('.');
  if (parts.length >= 2) {
    const sub = parts[0];
    // Skip if it's www, localhost alone, or an IP
    if (sub !== 'www' && sub !== 'localhost' && !/^\d+$/.test(sub)) {
      return sub;
    }
  }

  // 3. Query param fallback: ?tenant=slug
  const params = new URLSearchParams(window.location.search);
  const paramSlug = params.get('tenant');
  if (paramSlug) return paramSlug;

  // Fall back to "default" tenant
  return 'default';
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantState>({
    tenant: null,
    slug: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const slug = resolveSlug();
    if (!slug) {
      setState({ tenant: null, slug: null, loading: false, error: 'No tenant found' });
      return;
    }

    setState((s) => ({ ...s, slug, loading: true }));

    axios
      .get(`/api/tenants/branding?slug=${encodeURIComponent(slug)}`)
      .then(({ data }) => {
        setState({ tenant: data, slug, loading: false, error: null });

        // Apply primary color as CSS custom property if provided
        if (data.primary_color) {
          document.documentElement.style.setProperty('--tenant-primary', data.primary_color);
        }
      })
      .catch(() => {
        setState({ tenant: null, slug, loading: false, error: 'Tenant not found' });
      });
  }, []);

  return (
    <TenantContext.Provider value={state}>
      {children}
    </TenantContext.Provider>
  );
}
