import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatTime, relativeTime, getInitials } from '../../lib/utils';
import { Button, Card } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import type { ClientConversation, ClientMessage, User } from '../../types';

const ICON = {
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

function parseUTC(s: string) {
  return new Date(s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z');
}

function dayLabel(d: Date) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ClientMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [allStaff, setAllStaff] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<ClientConversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ClientMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');

  useEffect(() => {
    Promise.all([api.get('/messages/client-inbox'), api.get('/messages/recipients')])
      .then(([inboxRes, recipientsRes]) => {
        setConversations(inboxRes.data);
        setAllStaff(recipientsRes.data);
      })
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const openConversation = async (conv: ClientConversation) => {
    setSelectedConv(conv);
    setShowCompose(false);
    setComposeSearch('');
    setChatLoading(true);
    try {
      const { data } = await api.get(`/clients/${conv.client_id}/messages`, { params: { peer_id: conv.peer_id } });
      setChatMessages(data);
      window.dispatchEvent(new CustomEvent('unread-count-changed'));
    } catch {
      toast('Failed to load chat', 'error');
    } finally {
      setChatLoading(false);
    }
  };

  const openStaffConversation = (staff: User) => {
    const conv: ClientConversation = conversations.find((c) => c.peer_id === staff.id) ?? {
      client_id: user!.id,
      client_name: user?.full_name ?? null,
      peer_id: staff.id,
      peer_name: staff.full_name,
      last_message: null,
      last_message_at: null,
      last_message_author_name: null,
      message_count: 0,
    };
    openConversation(conv);
  };

  const visibleConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        (c.peer_name?.toLowerCase().includes(q) ?? false) ||
        (c.last_message?.toLowerCase().includes(q) ?? false),
    );
  }, [conversations, search]);

  const composeResults = useMemo(() => {
    if (!composeSearch.trim()) return allStaff.slice(0, 20);
    const q = composeSearch.toLowerCase();
    return allStaff.filter((s) => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [allStaff, composeSearch]);

  const handleSend = async () => {
    if (!selectedConv || !content.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post(`/clients/${selectedConv.client_id}/messages`, {
        content: content.trim(),
        recipient_id: selectedConv.peer_id,
      });
      setChatMessages((prev) => [...prev, data]);
      setContent('');
      setConversations((prev) => {
        const exists = prev.find((c) => c.peer_id === selectedConv.peer_id);
        const updated = {
          ...selectedConv,
          last_message: data.content,
          last_message_at: data.created_at,
          last_message_author_name: 'You',
          message_count: (selectedConv.message_count ?? 0) + 1,
        };
        if (exists) return prev.map((c) => (c.peer_id === selectedConv.peer_id ? updated : c));
        return [updated, ...prev];
      });
      setSelectedConv((prev) => (prev ? { ...prev, last_message: data.content, last_message_at: data.created_at } : prev));
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send message'), 'error');
    } finally {
      setSending(false);
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
      <div className="space-y-4">
        <div className="h-6 w-40 rounded shimmer" />
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl shimmer" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-8">
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Messages</span>
          </div>
          <h1 className="text-[26px] sm:text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Messages</h1>
          <p className="text-[14px] leading-6 text-[var(--led-muted)]">Chat with your broker and team</p>
        </div>
      </div>

      {conversations.length === 0 && !selectedConv && allStaff.length === 0 ? (
        <Card padding="none">
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
              <Ic d={ICON.chat} className="h-8 w-8 text-[var(--led-muted)]" />
            </div>
            <p className="mb-1 text-[14px] font-medium text-[var(--led-ink)]">No messages yet</p>
            <p className="text-[13px] text-[var(--led-muted)]">Your broker will appear here once your account is set up</p>
          </div>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="flex h-[calc(100vh-16rem)] min-h-[520px]">
            {/* Thread list */}
            <div className={`flex-col border-r border-[var(--led-line)] ${selectedConv ? 'hidden sm:flex sm:w-[320px] sm:shrink-0' : 'flex w-full sm:w-[320px] sm:shrink-0'}`}>
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
                  {allStaff.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setShowCompose((v) => !v); setComposeSearch(''); }}
                      aria-label={showCompose ? 'Cancel new conversation' : 'New conversation'}
                      title={showCompose ? 'Cancel' : 'New conversation'}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${showCompose ? 'border-[var(--led-line)] bg-[var(--led-surface-2)] text-[var(--led-muted)] hover:text-[var(--led-ink)]' : 'border-transparent bg-[var(--led-accent)] text-white shadow-[var(--led-shadow-sm)] hover:bg-[var(--led-accent-hover)]'}`}
                    >
                      <Ic d={showCompose ? ICON.close : ICON.plus} className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>

                {showCompose && (
                  <div className="absolute inset-x-0 top-full z-20 border-b border-[var(--led-line)] bg-[var(--led-surface-2)] p-3 shadow-[var(--led-shadow-md)]">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--led-muted)]">Reach a team member</p>
                    <div className="mb-2 flex h-9 items-center gap-2 rounded-xl border border-[var(--led-line)] bg-[var(--led-surface)] px-3">
                      <Ic d={ICON.search} className="h-4 w-4 shrink-0 text-[var(--led-muted)]" />
                      <input
                        autoFocus
                        value={composeSearch}
                        onChange={(e) => setComposeSearch(e.target.value)}
                        placeholder="Search by name or email…"
                        className="w-full bg-transparent text-[13px] text-[var(--led-ink)] placeholder-[var(--led-muted)] focus:outline-none"
                      />
                    </div>
                    <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                      {composeResults.length === 0 ? (
                        <p className="px-2 py-2 text-[12px] text-[var(--led-muted)]">No results</p>
                      ) : (
                        composeResults.slice(0, 20).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => openStaffConversation(s)}
                            className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--led-surface)]"
                          >
                            <Avatar name={s.full_name} className="h-8 w-8 text-[12px]" />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-[var(--led-ink)]">{s.full_name}</p>
                              <p className="truncate text-[11px] capitalize text-[var(--led-muted)]">{s.role} &middot; {s.email}</p>
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
                    <p className="text-[12px] text-[var(--led-muted)]">{search ? 'Nothing matches your search.' : 'Tap "New conversation" to message your broker.'}</p>
                  </div>
                ) : (
                  visibleConversations.map((conv) => {
                    const active = selectedConv?.peer_id === conv.peer_id;
                    return (
                      <button
                        key={conv.peer_id}
                        type="button"
                        onClick={() => openConversation(conv)}
                        className={`w-full border-b border-[var(--led-line-2)] px-4 py-3.5 text-left transition-colors ${active ? 'border-l-2 border-l-[var(--led-accent)] bg-[var(--led-accent-tint)]' : 'hover:bg-[var(--led-surface-2)]'}`}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar name={conv.peer_name || '?'} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[13px] font-semibold text-[var(--led-ink)]">{conv.peer_name ?? 'Unknown'}</span>
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
                    <Avatar name={selectedConv.peer_name || '?'} className="h-9 w-9 text-[13px]" />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[var(--led-ink)]">{selectedConv.peer_name}</p>
                      <p className="truncate text-[11px] text-[var(--led-muted)]">Usually replies within a few hours</p>
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
                                    <span className="text-[12px] font-semibold text-[var(--led-ink)]">{isOwn ? 'You' : (msg.author_name || 'Staff')}</span>
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
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        rows={2}
                        className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-[var(--led-ink)] placeholder-[var(--led-muted)] focus:outline-none"
                        placeholder={`Message ${selectedConv.peer_name ?? 'your broker'}…`}
                      />
                      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        <span className="text-[11px] text-[var(--led-muted)]">Enter to send · Shift+Enter for new line</span>
                        <Button size="sm" loading={sending} disabled={!content.trim()} onClick={handleSend}>
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
      )}
    </div>
  );
}
