import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate, formatTime } from '../../lib/utils';
import { Card, PageHeader, Button } from '../../components/ui';
import type { ClientConversation, ClientMessage, User } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { ArrowLeftIcon, ChatBubbleBottomCenterTextIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';

export default function ReferrerMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [allStaff, setAllStaff] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<ClientConversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ClientMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [newChatMsg, setNewChatMsg] = useState('');
  const [sendingChatMsg, setSendingChatMsg] = useState(false);

  const [showStaffSearch, setShowStaffSearch] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.get('/messages/client-inbox'),
      api.get('/messages/recipients'),
    ])
      .then(([convRes, recipientsRes]) => {
        const allConvs = convRes.data as ClientConversation[];
        // Only show staff conversations (referrer is the "client" subject)
        setConversations(allConvs.filter((c) => c.client_id === user.id));
        const recipients = recipientsRes.data as User[];
        setAllStaff(recipients.filter((u) => u.role === 'broker'));
      })
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Returns the display name for a conversation from the referrer's perspective
  const convDisplayName = (conv: ClientConversation) =>
    conv.peer_id === user?.id ? conv.client_name : conv.peer_name;

  const openConversation = async (conv: ClientConversation) => {
    setSelectedConv(conv);
    setShowStaffSearch(false);
    setStaffSearch('');
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
    const conv: ClientConversation = conversations.find(
      (c) => c.client_id === user!.id && c.peer_id === staff.id
    ) ?? {
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

  const handleSendChat = async () => {
    if (!selectedConv || !newChatMsg.trim() || !user) return;
    setSendingChatMsg(true);
    // If referrer is the subject (staff chat): recipient = peer; otherwise recipient = client
    const recipient_id = selectedConv.client_id === user.id ? selectedConv.peer_id : selectedConv.client_id;
    try {
      const { data } = await api.post(`/clients/${selectedConv.client_id}/messages`, {
        content: newChatMsg.trim(),
        recipient_id,
      });
      setChatMessages((prev) => [...prev, data]);
      setNewChatMsg('');
      const key = `${selectedConv.client_id}_${selectedConv.peer_id}`;
      setConversations((prev) => {
        const exists = prev.find((c) => `${c.client_id}_${c.peer_id}` === key);
        const updated = {
          ...selectedConv,
          last_message: data.content,
          last_message_at: data.created_at,
          last_message_author_name: 'You',
          message_count: (selectedConv.message_count ?? 0) + 1,
        };
        if (exists) {
          return prev.map((c) => `${c.client_id}_${c.peer_id}` === key ? updated : c);
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

  const filteredStaff = allStaff.filter(
    (s) =>
      s.full_name.toLowerCase().includes(staffSearch.toLowerCase()) ||
      s.email.toLowerCase().includes(staffSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Chat with your broker team" />
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
        subtitle="Chat with your broker team"
        action={
          <Button
            size="lg"
            onClick={() => {
              setShowStaffSearch((v) => !v);
              setStaffSearch('');
            }}
          >
            {showStaffSearch ? 'Cancel' : '+ Message Broker'}
          </Button>
        }
      />

      {/* New staff chat search */}
      {showStaffSearch && (
        <Card className="mb-6">
          <h3 className="text-[14px] font-semibold text-foreground mb-3">Message a broker</h3>
          <input
            type="text"
            autoFocus
            value={staffSearch}
            onChange={(e) => setStaffSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground mb-2"
          />
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {filteredStaff.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">No results</p>
            ) : (
              filteredStaff.slice(0, 20).map((s) => (
                <button
                  key={s.id}
                  onClick={() => openStaffConversation(s)}
                  className="w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors flex items-center gap-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                    <span className="text-[12px] font-semibold text-primary">{s.full_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{s.full_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.email}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      )}

      {conversations.length === 0 && !showStaffSearch && !selectedConv ? (
        <Card>
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <ChatBubbleBottomCenterTextIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-[15px] font-medium text-muted-foreground">No conversations yet</p>
            <p className="text-[13px] text-muted-foreground mt-1">Use "Message Broker" above to start a conversation</p>
          </div>
        </Card>
      ) : (conversations.length > 0 || !!selectedConv) && (
        <Card className="p-0 overflow-hidden border-0">
          <div className="flex h-[560px]">
            {/* Conversation list */}
            <div className={`flex flex-col border-r border-border/60 ${selectedConv ? 'hidden sm:flex sm:w-72' : 'flex w-full sm:w-72'}`}>
              <div className="px-4 py-3 border-b border-border/60">
                <p className="text-[13px] font-semibold text-foreground">Conversations</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.map((conv) => {
                  const displayName = convDisplayName(conv);
                  const convKey = `${conv.client_id}_${conv.peer_id}`;
                  const isSelected = selectedConv?.client_id === conv.client_id && selectedConv?.peer_id === conv.peer_id;
                  return (
                    <button
                      key={convKey}
                      onClick={() => openConversation(conv)}
                      className={`w-full text-left px-4 py-3.5 border-b border-border/40 transition-colors hover:bg-secondary/50 ${isSelected ? 'bg-primary/8 border-l-2 border-l-primary' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                          <span className="text-[13px] font-semibold text-primary">
                            {displayName?.charAt(0).toUpperCase() ?? '?'}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-semibold text-foreground truncate">{displayName ?? 'Unknown'}</p>
                          </div>
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
                  );
                })}
              </div>
            </div>

            {/* Chat thread */}
            <div className={`flex-1 flex flex-col ${selectedConv ? 'flex' : 'hidden sm:flex'}`}>
              {!selectedConv ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                  <ChatBubbleBottomCenterTextIcon className="h-10 w-10 text-muted-foreground" />
                  <p className="text-[13px] text-muted-foreground">Select a conversation</p>
                </div>
              ) : (
                <>
                  {/* Chat header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0">
                    <button
                      onClick={() => setSelectedConv(null)}
                      className="sm:hidden flex items-center justify-center h-7 w-7 rounded-lg hover:bg-secondary transition-colors"
                    >
                      <ArrowLeftIcon className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
                    </button>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                      <span className="text-[12px] font-semibold text-primary">
                        {convDisplayName(selectedConv)?.charAt(0).toUpperCase() ?? '?'}
                      </span>
                    </div>
                    <p className="text-[14px] font-semibold text-foreground">{convDisplayName(selectedConv)}</p>
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
                            <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-primary/10 text-primary rounded-tr-sm ring-1 ring-primary/20' : 'bg-secondary text-foreground rounded-tl-sm'}`}>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Compose */}
                  <div className="px-4 pb-4 pt-2">
                    <div className="rounded-2xl bg-secondary/40 border border-border/30 transition-colors focus-within:border-border/40">
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
                        className="msg-compose-textarea w-full appearance-none bg-transparent border-none shadow-none px-4 py-3 text-[14px] text-foreground focus:border-transparent focus:outline-none focus:ring-0 focus:shadow-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none placeholder-muted-foreground resize-none"
                        placeholder={`Message ${convDisplayName(selectedConv) ?? ''}…`}
                      />
                      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        <span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for new line</span>
                        <Button
                          size="sm"
                          className="rounded-xl h-8 px-3.5"
                          loading={sendingChatMsg}
                          disabled={!newChatMsg.trim()}
                          onClick={handleSendChat}
                        >
                          <PaperAirplaneIcon className="h-3.5 w-3.5 mr-1" strokeWidth={2} />
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
