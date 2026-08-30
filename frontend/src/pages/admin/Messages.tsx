import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatTime, relativeTime, getInitials } from '../../lib/utils';
import { Card, PageHeader, Button } from '../../components/ui';
import type { ClientConversation, ClientMessage, User } from '../../types';
import { useAuth } from '../../hooks/useAuth';

type Folder = 'all' | 'client' | 'broker' | 'referrer';

const ICON = {
  inbox: 'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
  users: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  building: 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.75a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V21',
  link: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244',
  search: 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z',
  plus: 'M12 4.5v15m7.5-7.5h-15',
  chat: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
  back: 'M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18',
  close: 'M6 18 18 6M6 6l12 12',
  send: 'M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5',
};

function Ic({ d, className = 'h-4 w-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function Avatar({ name, className = 'h-9 w-9 text-[13px]' }: { name: string; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--led-accent-tint)] font-semibold text-[var(--led-accent-ink)] ${className}`}>
      {getInitials(name)}
    </span>
  );
}

const FOLDERS: { value: Folder; label: string; icon: string }[] = [
  { value: 'all', label: 'Inbox', icon: ICON.inbox },
  { value: 'client', label: 'Borrowers', icon: ICON.users },
  { value: 'broker', label: 'Brokers', icon: ICON.building },
  { value: 'referrer', label: 'Referrers', icon: ICON.link },
];

function parseUTC(s: string) {
  return new Date(s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z');
}

function dayLabel(d: Date) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [allRecipients, setAllRecipients] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<ClientConversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ClientMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [newChatMsg, setNewChatMsg] = useState('');
  const [sendingChatMsg, setSendingChatMsg] = useState(false);

  const [folder, setFolder] = useState<Folder>('all');
  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');

  useEffect(() => {
    Promise.all([api.get('/messages/client-inbox'), api.get('/messages/recipients')])
      .then(([convRes, recipientsRes]) => {
        setConversations(convRes.data);
        setAllRecipients(recipientsRes.data);
      })
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const recipientById = useMemo(() => {
    const m = new Map<string, User>();
    allRecipients.forEach((r) => m.set(r.id, r));
    return m;
  }, [allRecipients]);

  const folderCounts = useMemo(() => {
    const counts: Record<Folder, number> = { all: 0, client: 0, broker: 0, referrer: 0 };
    conversations.forEach((conv) => {
      counts.all++;
      const role = recipientById.get(conv.client_id)?.role;
      if (role === 'client') counts.client++;
      else if (role === 'broker') counts.broker++;
      else if (role === 'referrer') counts.referrer++;
    });
    return counts;
  }, [conversations, recipientById]);

  const visibleConversations = useMemo(() => {
    let list = conversations;
    if (folder !== 'all') {
      list = list.filter((c) => recipientById.get(c.client_id)?.role === folder);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          (c.client_name?.toLowerCase().includes(q) ?? false) ||
          (c.last_message?.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [conversations, folder, search, recipientById]);

  const composeResults = useMemo(() => {
    if (!composeSearch.trim()) return allRecipients.slice(0, 20);
    const q = composeSearch.trim().toLowerCase();
    return allRecipients.filter(
      (r) => r.full_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
    );
  }, [allRecipients, composeSearch]);

  const openConversation = async (clientId: string, clientName: string) => {
    const conv: ClientConversation = conversations.find((c) => c.client_id === clientId) ?? {
      client_id: clientId,
      client_name: clientName,
      peer_id: user!.id,
      peer_name: user?.full_name ?? null,
      last_message: null,
      last_message_at: null,
      last_message_author_name: null,
      message_count: 0,
    };
    setSelectedConv(conv);
    setShowCompose(false);
    setComposeSearch('');
    setChatLoading(true);
    try {
      const { data } = await api.get(`/clients/${clientId}/messages`, { params: { peer_id: user!.id } });
      setChatMessages(data);
      window.dispatchEvent(new CustomEvent('unread-count-changed'));
    } catch {
      toast('Failed to load chat', 'error');
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendChat = async () => {
    if (!selectedConv || !newChatMsg.trim()) return;
    setSendingChatMsg(true);
    try {
      const { data } = await api.post(`/clients/${selectedConv.client_id}/messages`, {
        content: newChatMsg.trim(),
        recipient_id: selectedConv.client_id,
      });
      setChatMessages((prev) => [...prev, data]);
      setNewChatMsg('');
      setConversations((prev) => {
        const exists = prev.find((c) => c.client_id === selectedConv.client_id);
        const updated = {
          ...selectedConv,
          last_message: data.content,
          last_message_at: data.created_at,
          last_message_author_name: 'You',
          message_count: (selectedConv.message_count ?? 0) + 1,
        };
        if (exists) return prev.map((c) => (c.client_id === selectedConv.client_id ? updated : c));
        return [updated, ...prev];
      });
      setSelectedConv((prev) => (prev ? { ...prev, last_message: data.content, last_message_at: data.created_at } : prev));
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send'), 'error');
    } finally {
      setSendingChatMsg(false);
    }
  };

  const messagesByDay = useMemo(() => {
    const groups: { day: string; items: ClientMessage[] }[] = [];
    chatMessages.forEach((m) => {
      const dl = dayLabel(parseUTC(m.created_at));
      const last = groups[groups.length - 1];
      if (last && last.day === dl) last.items.push(m);
      else groups.push({ day: dl, items: [m] });
    });
    return groups;
  }, [chatMessages]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Message clients and referrers" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
      </div>
    );
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle={`${plural(folderCounts.all, 'thread')} · ${plural(folderCounts.client, 'borrower')} · ${plural(folderCounts.broker, 'broker')} · ${plural(folderCounts.referrer, 'referrer')}`}
      />

      <Card padding="none" className="overflow-hidden">
        <div className="flex h-[calc(100vh-13rem)] min-h-[560px]">
          {/* Folders rail */}
          <aside className="hidden w-[200px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--led-line)] p-3 lg:flex">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--led-muted)]">Folders</p>
            {FOLDERS.map((f) => {
              const active = folder === f.value;
              const count = folderCounts[f.value];
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFolder(f.value)}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${active ? 'bg-[var(--led-accent-tint)] text-[var(--led-accent-ink)]' : 'text-[var(--led-muted)] hover:bg-[var(--led-surface-2)] hover:text-[var(--led-ink)]'}`}
                >
                  <Ic d={f.icon} className="h-[18px] w-[18px] shrink-0" />
                  <span>{f.label}</span>
                  {count > 0 && (
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${active ? 'bg-[var(--led-accent-tint-2)] text-[var(--led-accent-ink)]' : 'bg-[var(--led-bg-2)] text-[var(--led-muted)]'}`}>{count}</span>
                  )}
                </button>
              );
            })}
          </aside>

          {/* Thread list */}
          <div className={`flex-col border-r border-[var(--led-line)] ${selectedConv ? 'hidden sm:flex sm:w-[340px] sm:shrink-0' : 'flex w-full sm:w-[340px] sm:shrink-0'}`}>
            <div className="relative z-10 border-b border-[var(--led-line)]">
              <div className="flex items-center gap-2 p-3">
                <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-3">
                  <Ic d={ICON.search} className="h-4 w-4 shrink-0 text-[var(--led-muted)]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search conversations…"
                    className="w-full bg-transparent text-[13px] text-[var(--led-ink)] placeholder-[var(--led-muted)] focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setShowCompose((v) => !v); setComposeSearch(''); }}
                  aria-label={showCompose ? 'Cancel new conversation' : 'New conversation'}
                  title={showCompose ? 'Cancel' : 'New conversation'}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${showCompose ? 'border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:text-[var(--led-ink)]' : 'border-transparent bg-[var(--led-accent)] text-white shadow-[var(--led-shadow-sm)] hover:bg-[var(--led-accent-hover)]'}`}
                >
                  <Ic d={showCompose ? ICON.close : ICON.plus} className="h-[18px] w-[18px]" />
                </button>
              </div>

              {showCompose && (
                <div className="absolute inset-x-0 top-full z-20 border-b border-[var(--led-line)] bg-[var(--led-surface-2)] p-3 shadow-[var(--led-shadow-md)]">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--led-muted)]">Start a new conversation</p>
                  <div className="mb-2 flex h-9 items-center gap-2 rounded-xl border border-[var(--led-line)] bg-[var(--led-surface)] px-3">
                    <Ic d={ICON.search} className="h-4 w-4 shrink-0 text-[var(--led-muted)]" />
                    <input
                      autoFocus
                      value={composeSearch}
                      onChange={(e) => setComposeSearch(e.target.value)}
                      placeholder="Search people…"
                      className="w-full bg-transparent text-[13px] text-[var(--led-ink)] placeholder-[var(--led-muted)] focus:outline-none"
                    />
                  </div>
                  <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                    {composeResults.length === 0 ? (
                      <p className="px-2 py-2 text-[12px] text-[var(--led-muted)]">No results</p>
                    ) : (
                      composeResults.slice(0, 20).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => openConversation(c.id, c.full_name)}
                          className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--led-surface)]"
                        >
                          <Avatar name={c.full_name} className="h-8 w-8 text-[12px]" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-[var(--led-ink)]">{c.full_name}</p>
                            <p className="truncate text-[11px] capitalize text-[var(--led-muted)]">{c.role} &middot; {c.email}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {visibleConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
                    <Ic d={ICON.chat} className="h-6 w-6 text-[var(--led-muted)]" />
                  </div>
                  <p className="text-[13px] font-medium text-[var(--led-ink)]">No conversations</p>
                  <p className="text-[12px] text-[var(--led-muted)]">{search ? 'Nothing matches your search.' : folder === 'all' ? 'Start one with the button above.' : 'No threads in this folder yet.'}</p>
                </div>
              ) : (
                visibleConversations.map((conv) => {
                  const active = selectedConv?.client_id === conv.client_id && selectedConv?.peer_id === conv.peer_id;
                  return (
                    <button
                      key={`${conv.client_id}_${conv.peer_id}`}
                      type="button"
                      onClick={() => openConversation(conv.client_id, conv.client_name ?? '')}
                      className={`w-full border-b border-[var(--led-line-2)] px-4 py-3.5 text-left transition-colors ${active ? 'border-l-2 border-l-[var(--led-accent)] bg-[var(--led-accent-tint)]' : 'hover:bg-[var(--led-surface-2)]'}`}
                    >
                      <div className="flex items-start gap-3">
                        <Avatar name={conv.client_name || '?'} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-semibold text-[var(--led-ink)]">{conv.client_name ?? 'Unknown'}</span>
                            {conv.last_message_at && (
                              <span className="shrink-0 text-[11px] text-[var(--led-muted)]">{relativeTime(conv.last_message_at)}</span>
                            )}
                          </div>
                          {conv.last_message ? (
                            <p className="mt-0.5 truncate text-[12px] text-[var(--led-muted)]">
                              <span className="text-[var(--led-ink-2)]">{conv.last_message_author_name === 'You' ? 'You' : conv.last_message_author_name}: </span>
                              {conv.last_message}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-[12px] italic text-[var(--led-muted)]">No messages yet</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Conversation */}
          <div className={`flex-1 flex-col bg-[var(--led-bg)] ${selectedConv ? 'flex' : 'hidden sm:flex'}`}>
            {!selectedConv ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
                  <Ic d={ICON.chat} className="h-7 w-7 text-[var(--led-muted)]" />
                </div>
                <p className="text-[14px] font-medium text-[var(--led-ink)]">Select a conversation</p>
                <p className="text-[13px] text-[var(--led-muted)]">Pick a thread from the list, or start a new conversation.</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex shrink-0 items-center gap-3 border-b border-[var(--led-line)] bg-[var(--led-surface)] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedConv(null)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--led-surface-2)] sm:hidden"
                    aria-label="Back"
                  >
                    <Ic d={ICON.back} className="h-4 w-4 text-[var(--led-muted)]" />
                  </button>
                  <Avatar name={selectedConv.client_name || '?'} className="h-9 w-9 text-[13px]" />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-[var(--led-ink)]">{selectedConv.client_name}</p>
                    <p className="truncate text-[11px] capitalize text-[var(--led-muted)]">
                      {recipientById.get(selectedConv.client_id)?.role ?? 'contact'} &middot; {recipientById.get(selectedConv.client_id)?.email ?? '—'}
                    </p>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {chatLoading ? (
                    <div className="flex flex-col gap-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className={`h-14 w-[70%] rounded-2xl shimmer ${i % 2 ? 'self-end' : 'self-start'}`} />
                      ))}
                    </div>
                  ) : chatMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
                        <Ic d={ICON.chat} className="h-6 w-6 text-[var(--led-muted)]" />
                      </div>
                      <p className="text-[13px] font-medium text-[var(--led-ink)]">No messages yet</p>
                      <p className="text-[12px] text-[var(--led-muted)]">Say hello — your message will appear here.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {messagesByDay.map((group, gi) => (
                        <div key={gi} className="flex flex-col gap-3">
                          <div className="my-1 flex items-center gap-3">
                            <div className="h-px flex-1 bg-[var(--led-line)]" />
                            <span className="text-[11px] font-medium text-[var(--led-muted)]">{group.day}</span>
                            <div className="h-px flex-1 bg-[var(--led-line)]" />
                          </div>
                          {group.items.map((msg) => {
                            const isOwn = msg.author_id === user?.id;
                            return (
                              <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                                <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                                  <span className="text-[12px] font-semibold text-[var(--led-ink)]">{isOwn ? 'You' : (msg.author_name || 'Client')}</span>
                                  <span className="text-[11px] text-[var(--led-muted)]">{formatTime(msg.created_at)}</span>
                                </div>
                                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'rounded-tr-sm bg-[var(--led-accent-tint-2)] text-[var(--led-accent-ink)] ring-1 ring-[var(--led-accent)]/15' : 'rounded-tl-sm border border-[var(--led-line)] bg-[var(--led-surface)] text-[var(--led-ink)] shadow-[var(--led-shadow-sm)]'}`}>
                                  <p className="whitespace-pre-wrap">{msg.content}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                {/* Composer */}
                <div className="shrink-0 border-t border-[var(--led-line)] bg-[var(--led-surface)] px-4 py-3">
                  <div className="rounded-2xl border border-[var(--led-line)] bg-[var(--led-surface-2)] transition-colors focus-within:border-[var(--led-accent)]/40">
                    <textarea
                      value={newChatMsg}
                      onChange={(e) => setNewChatMsg(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChat();
                        }
                      }}
                      rows={2}
                      className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-[var(--led-ink)] placeholder-[var(--led-muted)] focus:outline-none"
                      placeholder={`Message ${selectedConv.client_name ?? 'recipient'}…`}
                    />
                    <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                      <span className="text-[11px] text-[var(--led-muted)]">Enter to send · Shift+Enter for new line</span>
                      <Button size="sm" loading={sendingChatMsg} disabled={!newChatMsg.trim()} onClick={handleSendChat}>
                        <Ic d={ICON.send} className="h-3.5 w-3.5" />
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
