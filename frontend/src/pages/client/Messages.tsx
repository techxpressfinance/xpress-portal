import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate, formatTime } from '../../lib/utils';
import { Button, GlassCard, PageHeader } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import type { ClientConversation, ClientMessage } from '../../types';

export default function ClientMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<ClientConversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ClientMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get('/messages/client-inbox')
      .then(({ data }) => setConversations(data))
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const openConversation = async (conv: ClientConversation) => {
    setSelectedConv(conv);
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
      setConversations((prev) =>
        prev.map((c) =>
          c.peer_id === selectedConv.peer_id
            ? { ...c, last_message: data.content, last_message_at: data.created_at, last_message_author_name: 'You', message_count: c.message_count + 1 }
            : c
        )
      );
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send message'), 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Chat with your broker or referrer" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Chat with your broker or referrer" />
        <GlassCard>
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-muted-foreground">No messages yet</p>
            <p className="text-[13px] text-muted-foreground mt-1">Your broker or referrer will reach out here</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Messages" subtitle="Chat with your broker or referrer" />

      <GlassCard className="p-0 overflow-hidden">
        <div className="flex h-[560px]">
          {/* Conversation list — hidden on mobile when a conv is selected */}
          <div className={`flex flex-col border-r border-border/60 ${selectedConv ? 'hidden sm:flex sm:w-72' : 'flex w-full sm:w-72'}`}>
            <div className="px-4 py-3 border-b border-border/60">
              <p className="text-[13px] font-semibold text-foreground">Conversations</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map((conv) => (
                <button
                  key={conv.peer_id}
                  onClick={() => openConversation(conv)}
                  className={`w-full text-left px-4 py-3.5 border-b border-border/40 transition-colors hover:bg-secondary/50 ${selectedConv?.peer_id === conv.peer_id ? 'bg-primary/8 border-l-2 border-l-primary' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <span className="text-[13px] font-semibold text-primary">
                        {conv.peer_name?.charAt(0).toUpperCase() ?? '?'}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground truncate">{conv.peer_name ?? 'Unknown'}</p>
                      {conv.last_message ? (
                        <p className="text-[12px] text-muted-foreground truncate">
                          {conv.last_message_author_name}: {conv.last_message}
                        </p>
                      ) : (
                        <p className="text-[12px] text-muted-foreground italic">No messages yet</p>
                      )}
                    </div>
                    {conv.last_message_at && (
                      <span className="text-[11px] text-muted-foreground shrink-0">{formatDate(conv.last_message_at)}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Chat thread */}
          <div className={`flex-1 flex flex-col ${selectedConv ? 'flex' : 'hidden sm:flex'}`}>
            {!selectedConv ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                </svg>
                <p className="text-[13px] text-muted-foreground">Select a conversation</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0">
                  <button
                    onClick={() => setSelectedConv(null)}
                    className="sm:hidden flex items-center justify-center h-7 w-7 rounded-lg hover:bg-secondary transition-colors"
                  >
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                  </button>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                    <span className="text-[12px] font-semibold text-primary">
                      {selectedConv.peer_name?.charAt(0).toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <p className="text-[14px] font-semibold text-foreground">{selectedConv.peer_name}</p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
                  {chatLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <svg className="h-5 w-5 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    </div>
                  ) : chatMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                      <p className="text-[13px] text-muted-foreground">No messages yet — say hello</p>
                    </div>
                  ) : (
                    chatMessages.map((msg) => {
                      const isOwn = msg.author_id === user?.id;
                      return (
                        <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                          <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                            <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || 'Staff')}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatTime(msg.created_at)}
                            </span>
                          </div>
                          <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm'}`}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Compose */}
                <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border/60">
                  <div className="rounded-2xl bg-secondary/40 border border-border/30 focus-within:border-border/40 transition-colors flex flex-col">
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
                      className="msg-compose-textarea w-full appearance-none bg-transparent border-none shadow-none px-4 py-3 text-[14px] text-foreground focus:border-transparent focus:outline-none focus:ring-0 focus:shadow-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none placeholder-muted-foreground resize-none"
                      placeholder={`Message ${selectedConv.peer_name ?? 'your broker'}…`}
                    />
                    <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                      <span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for new line</span>
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
    </div>
  );
}
