import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, PageHeader, Button } from '../../components/ui';
import type { ClientConversation, ClientMessage, User } from '../../types';
import { useAuth } from '../../hooks/useAuth';

export default function AdminMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [allClients, setAllClients] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<ClientConversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ClientMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [newChatMsg, setNewChatMsg] = useState('');
  const [sendingChatMsg, setSendingChatMsg] = useState(false);

  // New chat search
  const [showSearch, setShowSearch] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/messages/client-inbox'),
      api.get('/messages/recipients'),
    ])
      .then(([convRes, recipientsRes]) => {
        setConversations(convRes.data);
        setAllClients(recipientsRes.data);
      })
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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
    setShowSearch(false);
    setClientSearch('');
    setChatLoading(true);
    try {
      const { data } = await api.get(`/clients/${clientId}/messages`, { params: { peer_id: user!.id } });
      setChatMessages(data);
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
        if (exists) {
          return prev.map((c) => c.client_id === selectedConv.client_id ? updated : c);
        }
        return [updated, ...prev];
      });
      setSelectedConv((prev) => prev ? { ...prev, last_message: data.content, last_message_at: data.created_at } : prev);
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send'), 'error');
    } finally {
      setSendingChatMsg(false);
    }
  };

  const filteredClients = allClients.filter(
    (c) =>
      c.role === 'client' &&
      (c.full_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
       c.email.toLowerCase().includes(clientSearch.toLowerCase()))
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Chat with clients and referrers" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Chat with clients and referrers"
        action={
          <Button onClick={() => { setShowSearch((v) => !v); setClientSearch(''); }}>
            {showSearch ? 'Cancel' : '+ New Chat'}
          </Button>
        }
      />

      {/* New chat search */}
      {showSearch && (
        <GlassCard className="mb-6">
          <h3 className="text-[14px] font-semibold text-foreground mb-3">Start a new conversation</h3>
          <input
            type="text"
            autoFocus
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Search clients or referrers..."
            className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground mb-2"
          />
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {filteredClients.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">No results</p>
            ) : (
              filteredClients.slice(0, 20).map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id, c.full_name)}
                  className="w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors flex items-center gap-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                    <span className="text-[12px] font-semibold text-primary">{c.full_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{c.full_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate capitalize">{c.role} &middot; {c.email}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </GlassCard>
      )}

      {conversations.length === 0 && !showSearch && !selectedConv ? (
        <GlassCard>
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-muted-foreground">No conversations yet</p>
            <p className="text-[13px] text-muted-foreground mt-1">Use "+ New Chat" to start a conversation</p>
          </div>
        </GlassCard>
      ) : (conversations.length > 0 || selectedConv) && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="flex h-[560px]">
            {/* Conversation list */}
            <div className={`flex flex-col border-r border-border/60 ${selectedConv ? 'hidden sm:flex sm:w-72' : 'flex w-full sm:w-72'}`}>
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-foreground">Conversations</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.map((conv) => (
                  <button
                    key={`${conv.client_id}_${conv.peer_id}`}
                    onClick={() => openConversation(conv.client_id, conv.client_name ?? '')}
                    className={`w-full text-left px-4 py-3.5 border-b border-border/40 transition-colors hover:bg-secondary/50 ${selectedConv?.client_id === conv.client_id && selectedConv?.peer_id === conv.peer_id ? 'bg-primary/8 border-l-2 border-l-primary' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                        <span className="text-[13px] font-semibold text-primary">
                          {conv.client_name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground truncate">{conv.client_name ?? 'Unknown'}</p>
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
                        {selectedConv.client_name?.charAt(0).toUpperCase() ?? '?'}
                      </span>
                    </div>
                    <p className="text-[14px] font-semibold text-foreground">{selectedConv.client_name}</p>
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
                              <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : (msg.author_name || 'Client')}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                    <div className="rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 transition-colors flex flex-col">
                      <textarea
                        value={newChatMsg}
                        onChange={(e) => setNewChatMsg(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            handleSendChat();
                          }
                        }}
                        rows={2}
                        className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none"
                        placeholder={`Message ${selectedConv.client_name ?? 'client'}…`}
                      />
                      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        <span className="text-[11px] text-muted-foreground">⌘↵ to send</span>
                        <Button
                          size="sm"
                          className="rounded-xl h-8 px-3.5"
                          loading={sendingChatMsg}
                          disabled={!newChatMsg.trim()}
                          onClick={handleSendChat}
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
