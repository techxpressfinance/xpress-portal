import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import { getTenantSlug } from '../api/client';
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

// One resolver for the whole app — the API client's rule, so the branding
// request and every API call agree on which tenant this page belongs to.
function resolveSlug(): string | null {
  return getTenantSlug();
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantState>({
    tenant: null,
    slug: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    // A null slug is normal in production: on a host with no tenant subdomain
    // the server answers with its DEFAULT_TENANT_SLUG, and we take the slug
    // from the branding it returns rather than guessing one here.
    const slug = resolveSlug();
    setState((s) => ({ ...s, slug, loading: true }));

    axios
      .get('/api/tenants/branding', { params: slug ? { slug } : undefined })
      .then(({ data }) => {
        setState({ tenant: data, slug: data.slug ?? slug, loading: false, error: null });

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
