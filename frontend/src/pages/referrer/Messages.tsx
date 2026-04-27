import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, PageHeader, Button } from '../../components/ui';
import type { DirectMessage, User } from '../../types';
import { useAuth } from '../../hooks/useAuth';

export default function ReferrerMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [recipients, setRecipients] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'inbox' | 'sent'>('inbox');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/messages?per_page=50'),
      api.get('/messages/recipients'),
    ])
      .then(([msgRes, recipientsRes]) => {
        setMessages(msgRes.data.items);
        setRecipients(recipientsRes.data);
      })
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filteredRecipients = recipients.filter(
    (r) =>
      r.full_name.toLowerCase().includes(recipientSearch.toLowerCase()) ||
      r.email.toLowerCase().includes(recipientSearch.toLowerCase())
  );

  const handleSend = async () => {
    if (!recipientId || !subject.trim() || !content.trim()) {
      toast('Please fill in all fields', 'error');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post('/messages', {
        recipient_id: recipientId,
        subject: subject.trim(),
        content: content.trim(),
      });
      setMessages((prev) => [data, ...prev]);
      setShowCompose(false);
      setRecipientId('');
      setSubject('');
      setContent('');
      setRecipientSearch('');
      toast('Message sent', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send message'), 'error');
    } finally {
      setSending(false);
    }
  };

  const handleExpand = async (id: string, msg?: DirectMessage) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (msg && !msg.is_read && msg.recipient_id === user?.id) {
      try {
        await api.get(`/messages/${msg.id}`);
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m))
        );
      } catch { /* ignore */ }
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Send messages to your broker team" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl shimmer" />
          ))}
        </div>
      </div>
    );
  }

  const inboxMessages = messages.filter((msg) => msg.recipient_id === user?.id);
  const sentMessages = messages.filter((msg) => msg.sender_id === user?.id);
  const visibleMessages = activeTab === 'inbox' ? inboxMessages : sentMessages;

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Send messages to your broker team"
        action={
          <Button onClick={() => setShowCompose(!showCompose)}>
            {showCompose ? 'Cancel' : '+ New Message'}
          </Button>
        }
      />

      {showCompose && (
        <GlassCard className="mb-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4">New Message</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                Recipient
              </label>
              <input
                type="text"
                value={recipientSearch}
                onChange={(e) => {
                  setRecipientSearch(e.target.value);
                  setRecipientId('');
                }}
                placeholder="Search brokers or admins..."
                className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
              />
              {recipientSearch && !recipientId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-xl bg-secondary border border-border">
                  {filteredRecipients.length === 0 ? (
                    <p className="px-3 py-2 text-[13px] text-muted-foreground">No staff found</p>
                  ) : (
                    filteredRecipients.slice(0, 10).map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setRecipientId(r.id);
                          setRecipientSearch(r.full_name);
                        }}
                        className="w-full text-left px-3 py-2 text-[13px] text-foreground hover:bg-background/50 transition-colors"
                      >
                        <span className="font-medium">{r.full_name}</span>{' '}
                        <span className="text-muted-foreground capitalize">({r.role})</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Message subject..."
                className="w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-2">
                Message
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder="Write your message..."
                className="w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder-muted-foreground"
              />
            </div>
            <Button onClick={handleSend} loading={sending} disabled={!recipientId || !subject.trim() || !content.trim()}>
              Send Message
            </Button>
          </div>
        </GlassCard>
      )}

      <div className="mb-4 inline-flex rounded-xl border border-border bg-secondary p-1">
        <button
          type="button"
          onClick={() => setActiveTab('inbox')}
          className={`px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${activeTab === 'inbox' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Inbox
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sent')}
          className={`px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${activeTab === 'sent' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Sent
        </button>
      </div>

      {visibleMessages.length === 0 ? (
        <GlassCard>
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
            </div>
            <p className="text-[15px] font-medium text-muted-foreground">
              {activeTab === 'inbox' ? 'No inbox messages yet' : 'No sent messages yet'}
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              {activeTab === 'inbox'
                ? 'Messages from your broker team will appear here'
                : 'Messages you\'ve sent will appear here'}
            </p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {visibleMessages.map((msg) => {
            const isInbox = activeTab === 'inbox';
            return (
              <div
                key={msg.id}
                className={isInbox ? 'cursor-pointer' : ''}
                onClick={isInbox ? () => handleExpand(msg.id, msg) : undefined}
              >
                <GlassCard>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isInbox && !msg.is_read ? 'bg-primary' : 'bg-secondary'}`}>
                        <svg className={`h-5 w-5 ${isInbox && !msg.is_read ? 'text-primary-foreground' : 'text-muted-foreground'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                      </div>
                      <div className="min-w-0">
                        <p className={`truncate text-[14px] ${isInbox && !msg.is_read ? 'font-semibold' : 'font-medium'} text-foreground`}>
                          {msg.subject}
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          {isInbox
                            ? `From ${msg.sender_name || 'Staff'}`
                            : `To ${msg.recipient_name || 'Broker'}`} &middot; {formatDate(msg.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isInbox && !msg.is_read && (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      )}
                      {!isInbox && (
                        msg.is_read ? (
                          <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-medium text-success">Read</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">Unread</span>
                        )
                      )}
                      <svg className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${expandedId === msg.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                    </div>
                  </div>
                  {expandedId === msg.id && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <p className="text-[14px] text-foreground whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  )}
                </GlassCard>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
