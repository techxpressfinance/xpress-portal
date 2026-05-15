import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate, formatTime } from '../../lib/utils';
import { Button, GlassCard } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import type { ClientConversation, ClientMessage, User } from '../../types';

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
  const [showSearch, setShowSearch] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/messages/client-inbox'),
      api.get('/messages/recipients'),
    ])
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
    setShowSearch(false);
    setStaffSearch('');
    setChatLoading(true);
    try {
      const { data } = await api.get(`/clients/${conv.client_id}/messages`, { params: { peer_id: conv.peer_id } });
      setChatMessages(data);
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

  const filteredStaff = allStaff.filter(
    (s) =>
      s.full_name.toLowerCase().includes(staffSearch.toLowerCase()) ||
      s.email.toLowerCase().includes(staffSearch.toLowerCase())
  );

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
        if (exists) {
          return prev.map((c) => c.peer_id === selectedConv.peer_id ? updated : c);
        }
        return [updated, ...prev];
      });
      setSelectedConv((prev) => prev ? { ...prev, last_message: data.content, last_message_at: data.created_at } : prev);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send message'), 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="space-y-4">
          <div className="h-6 w-40 rounded shimmer" />
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col pb-8">
      <div className="mb-8 mt-2 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="led-chip led-chip-accent">Messages</span>
          </div>
          <h1 className="text-[34px] font-semibold tracking-[-0.05em] text-[var(--led-ink)]">Messages</h1>
          <p className="text-[14px] leading-6 text-[var(--led-muted)]">Chat with your broker or referrer</p>
        </div>
        {allStaff.length > 0 && (
          <Button
            size="lg"
            onClick={() => { setShowSearch((v) => !v); setStaffSearch(''); }}
          >
            {showSearch ? 'Cancel' : '+ New Chat'}
          </Button>
        )}
      </div>

      {showSearch && (
        <GlassCard padding="none" className="mb-6">
          <div className="border-b border-[var(--led-line)] px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--led-muted)]">New Conversation</p>
            <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--led-ink)]">Start a new conversation</h2>
          </div>
          <div className="p-6">
            <input
              type="text"
              autoFocus
              value={staffSearch}
              onChange={(e) => setStaffSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full rounded-xl border border-[var(--led-line)] bg-[var(--led-surface-2)] px-4 py-2.5 text-[14px] text-[var(--led-ink)] placeholder:text-[var(--led-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--led-accent)]/30 transition-all mb-3"
            />
            <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--led-line)] divide-y divide-[var(--led-line)]">
              {filteredStaff.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-[var(--led-muted)]">No results</p>
              ) : (
                filteredStaff.slice(0, 20).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openStaffConversation(s)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--led-surface-2)] transition-colors flex items-center gap-3"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--led-accent-tint)]">
                      <span className="text-[12px] font-semibold text-[var(--led-accent-ink)]">{s.full_name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[var(--led-ink)] truncate">{s.full_name}</p>
                      <p className="text-[11px] text-[var(--led-muted)] truncate capitalize">{s.role} &middot; {s.email}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </GlassCard>
      )}

      {conversations.length === 0 && !showSearch && !selectedConv ? (
        <GlassCard padding="none">
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--led-surface-2)]">
              <svg className="h-8 w-8 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-[var(--led-ink)] mb-1">No messages yet</p>
            <p className="text-[13px] text-[var(--led-muted)]">Use "+ New Chat" to reach your broker or referrer</p>
          </div>
        </GlassCard>
      ) : (conversations.length > 0 || !!selectedConv) && (
        <GlassCard className="p-0 overflow-hidden border-0">
          <div className="flex h-[560px] rounded-2xl border border-[var(--led-line)] bg-[var(--led-surface)] overflow-hidden">
            <div className={`flex flex-col border-r border-[var(--led-line)] ${selectedConv ? 'hidden sm:flex sm:w-72' : 'flex w-full sm:w-72'}`}>
              <div className="px-4 py-3 border-b border-[var(--led-line)]">
                <p className="text-[13px] font-semibold text-[var(--led-ink)]">Conversations</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.map((conv) => (
                  <button
                    key={conv.peer_id}
                    onClick={() => openConversation(conv)}
                    className={`w-full text-left px-4 py-3.5 border-b border-[var(--led-line)]/40 transition-colors hover:bg-[var(--led-surface-2)] ${selectedConv?.peer_id === conv.peer_id ? 'bg-[var(--led-accent-tint)] border-l-2 border-l-[var(--led-accent)]' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--led-accent-tint)]">
                        <span className="text-[13px] font-semibold text-[var(--led-accent-ink)]">
                          {conv.peer_name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-[var(--led-ink)] truncate">{conv.peer_name ?? 'Unknown'}</p>
                        {conv.last_message ? (
                          <p className="text-[12px] text-[var(--led-muted)] truncate">
                            {conv.last_message_author_name}: {conv.last_message}
                          </p>
                        ) : (
                          <p className="text-[12px] text-[var(--led-muted)] italic">No messages yet</p>
                        )}
                      </div>
                      {conv.last_message_at && (
                        <span className="text-[11px] text-[var(--led-muted)] shrink-0">{formatDate(conv.last_message_at)}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className={`flex-1 flex flex-col ${selectedConv ? 'flex' : 'hidden sm:flex'}`}>
              {!selectedConv ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                  <svg className="h-10 w-10 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                  </svg>
                  <p className="text-[13px] text-[var(--led-muted)]">Select a conversation</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--led-line)] shrink-0">
                    <button
                      onClick={() => setSelectedConv(null)}
                      className="sm:hidden flex items-center justify-center h-7 w-7 rounded-lg hover:bg-[var(--led-surface-2)] transition-colors"
                    >
                      <svg className="h-4 w-4 text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                    </button>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--led-accent-tint)]">
                      <span className="text-[12px] font-semibold text-[var(--led-accent-ink)]">
                        {selectedConv.peer_name?.charAt(0).toUpperCase() ?? '?'}
                      </span>
                    </div>
                    <p className="text-[14px] font-semibold text-[var(--led-ink)]">{selectedConv.peer_name}</p>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
                    {chatLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <svg className="h-5 w-5 animate-spin text-[var(--led-muted)]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      </div>
                    ) : chatMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                        <p className="text-[13px] text-[var(--led-muted)]">No messages yet — say hello</p>
                      </div>
                    ) : (
                      chatMessages.map((msg) => {
                        const isOwn = msg.author_id === user?.id;
                        return (
                          <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                            <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                              <span className="text-[12px] font-semibold text-[var(--led-ink)]">{isOwn ? 'You' : (msg.author_name || 'Staff')}</span>
                              <span className="text-[11px] text-[var(--led-muted)]">
                                {formatTime(msg.created_at)}
                              </span>
                            </div>
                            <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-[var(--led-accent)] text-[var(--led-accent-ink)] rounded-tr-sm' : 'bg-[var(--led-surface-2)] text-[var(--led-ink)] rounded-tl-sm'}`}>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="shrink-0 px-4 pb-4 pt-2 border-t border-[var(--led-line)]">
                    <div className="rounded-2xl bg-[var(--led-surface-2)] border border-[var(--led-line)] transition-colors focus-within:border-[var(--led-accent)]/40">
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
                        className="msg-compose-textarea w-full appearance-none bg-transparent border-none shadow-none px-4 py-3 text-[14px] text-[var(--led-ink)] focus:border-transparent focus:outline-none focus:ring-0 focus:shadow-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none placeholder-[var(--led-muted)] resize-none"
                        placeholder={`Message ${selectedConv.peer_name ?? 'your broker'}…`}
                      />
                      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        <span className="text-[11px] text-[var(--led-muted)]">Enter to send · Shift+Enter for new line</span>
                        <Button
                          size="sm"
                          className="rounded-xl h-8 px-3.5"
                          loading={sending}
                          disabled={!content.trim()}
                          onClick={handleSend}
                        >
                          <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
