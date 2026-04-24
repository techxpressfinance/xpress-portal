import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { Button, GlassCard, PageHeader } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import type { ClientMessage } from '../../types';

export default function ClientMessages() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/clients/${user.id}/messages`)
      .then(({ data }) => {
        setMessages(data);
      })
      .catch(() => toast('Failed to load messages', 'error'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!user?.id || !content.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post(`/clients/${user.id}/messages`, { content: content.trim() });
      setMessages((prev) => [...prev, data]);
      setContent('');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to send message'), 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Messages" subtitle="Messages with your broker team" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl shimmer" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Messages" subtitle="Messages with your broker team" />

      <GlassCard>
        {/* Message thread */}
        <div className="flex flex-col gap-4 min-h-[300px] max-h-[500px] overflow-y-auto pr-1 mb-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 py-16 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
              </div>
              <p className="text-[15px] font-medium text-muted-foreground">No messages yet</p>
              <p className="text-[13px] text-muted-foreground mt-1">Send a message to start the conversation with your broker</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.author_id === user?.id;
              return (
                <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-foreground">
                      {isOwn ? 'You' : (msg.author_name || 'Staff')}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDate(msg.created_at)} &middot; {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className={`rounded-2xl px-4 py-2.5 text-[14px] max-w-[80%] ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-foreground'}`}>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose */}
        <div className="relative rounded-2xl bg-secondary/40 border border-border/50 focus-within:border-primary/50 focus-within:bg-secondary/60 transition-all duration-300 flex flex-col pt-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
            }}
            rows={3}
            className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none"
            placeholder="Write a message to your broker..."
          />
          <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-border/30 mt-1">
            <span className="text-[11px] text-muted-foreground">⌘↵ to send</span>
            <Button
              size="sm"
              className="rounded-xl px-4 h-9"
              loading={sending}
              disabled={!content.trim()}
              onClick={handleSend}
            >
              <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
              Send
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
