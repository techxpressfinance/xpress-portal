import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { DOC_TYPE_LABELS, STATUS_BADGE, ROLE_BADGE } from '../lib/constants';
import { formatDate } from '../lib/utils';
import type { GlobalSearchResponse } from '../types';

export default function GlobalSearch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'broker' || user?.role === 'referrer';

  // Keyboard shortcut to open
  useEffect(() => {
    if (!isAdmin) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isAdmin]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults(null);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get<GlobalSearchResponse>('/search', { params: { q, limit: 10 } });
      setResults(data);
      setSelectedIndex(0);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const flatItems = useMemo(() => {
    const items: { type: 'application' | 'user' | 'document'; id: string; appId?: string }[] = [];
    if (results) {
      for (const app of results.applications) items.push({ type: 'application', id: app.id });
      for (const u of results.users) items.push({ type: 'user', id: u.id });
      for (const d of results.documents) items.push({ type: 'document', id: d.id, appId: d.application_id });
    }
    return items;
  }, [results]);

  if (!isAdmin) return null;

  const navigateTo = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatItems[selectedIndex]) {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item.type === 'application') navigateTo(`/admin/applications/${item.id}`);
      else if (item.type === 'document') navigateTo(`/admin/applications/${item.appId}`);
      else navigateTo('/admin/users');
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  if (!open) return null;

  let currentFlatIndex = 0;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={() => setOpen(false)}
      />

      {/* Dialog */}
      <div
        className="relative w-full max-w-xl mx-4 rounded-2xl bg-background border border-border shadow-2xl overflow-hidden"
        style={{ animation: 'fadeInUp 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        {/* Search input */}
        <div className="relative">
          <div className="flex items-center gap-3.5 px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <svg className="h-[18px] w-[18px] text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search applications, clients, users..."
              className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
            {loading && (
              <div className="h-4.5 w-4.5 shrink-0 rounded-full border-2 border-muted-foreground/20 border-t-primary animate-spin" />
            )}
            {query && !loading && (
              <button
                onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <kbd className="hidden sm:inline-flex shrink-0 items-center rounded-lg bg-secondary/80 px-2 py-1 text-[11px] font-medium text-muted-foreground/70 border border-border/50">
              ESC
            </kbd>
          </div>
          <div className="mx-5 border-b border-border" />
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {query.length < 2 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] text-muted-foreground">Type at least 2 characters to search</p>
            </div>
          ) : loading && !results ? (
            <div className="py-10 text-center">
              <p className="text-[13px] text-muted-foreground">Searching...</p>
            </div>
          ) : results && flatItems.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] text-muted-foreground">No results for "{query}"</p>
            </div>
          ) : results ? (
            <div className="py-2">
              {/* Applications */}
              {results.applications.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Applications
                  </p>
                  {results.applications.map((app) => {
                    const idx = currentFlatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={app.id}
                        onClick={() => navigateTo(`/admin/applications/${app.id}`)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-medium text-foreground truncate">
                              {app.user_name || 'Unknown'}{' '}
                              <span className="text-muted-foreground font-normal capitalize">— {app.loan_type}</span>
                            </p>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">
                            ${Number(app.amount).toLocaleString()}
                            {app.created_at && ` · ${formatDate(app.created_at)}`}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_BADGE[app.status]}`}>
                          {app.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Users */}
              {results.users.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Users
                  </p>
                  {results.users.map((u) => {
                    const idx = currentFlatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={u.id}
                        onClick={() => navigateTo('/admin/users')}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {u.full_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{u.full_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_BADGE[u.role]}`}>
                          {u.role}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Documents */}
              {results.documents.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Documents
                  </p>
                  {results.documents.map((doc) => {
                    const idx = currentFlatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={doc.id}
                        onClick={() => navigateTo(`/admin/applications/${doc.application_id}`)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chart-3/10">
                          <svg className="h-4 w-4 text-chart-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{doc.original_filename}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                            {doc.user_name && ` · ${doc.user_name}`}
                            {doc.uploaded_at && ` · ${formatDate(doc.uploaded_at)}`}
                          </p>
                        </div>
                        {doc.is_verified && (
                          <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium bg-success/10 text-success">
                            Verified
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {results && flatItems.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">&uarr;&darr;</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">&crarr;</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">esc</kbd>
              close
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
