import { useState } from 'react';
import { BookmarkIcon, ChatBubbleBottomCenterTextIcon, PaperAirplaneIcon, TrashIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { Button } from '../ui';
import { formatTime } from '../../lib/utils';
import type { ClientMessage } from '../../types';

interface Props {
  messages: ClientMessage[];
  currentUserId: string | undefined;
  /** Shown as the author of the other side's messages when author_name is missing. */
  counterpartName: string;
  /** True when the counterpart is the current user (their own application). */
  isSelf: boolean;
  pinnedIds: Set<string>;
  pinningId: string | null;
  onPin: (msg: ClientMessage, who: string) => void;
  onDelete: (msg: ClientMessage) => void;
  /** Resolves when sent; rejects to keep the draft. */
  onSend: (content: string) => Promise<void>;
}

/** One application-scoped conversation (client or referrer): bubbles + composer. */
export default function ChatThread({ messages, currentUserId, counterpartName, isSelf, pinnedIds, pinningId, onPin, onDelete, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const content = draft.trim();
    if (!content || isSelf || sending) return;
    setSending(true);
    try {
      await onSend(content);
      setDraft('');
    } catch {
      // onSend reports the error; keep the draft so nothing is lost.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] animate-in fade-in duration-200">
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 mb-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-60">
            <ChatBubbleBottomCenterTextIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.author_id === currentUserId;
            const isPinned = pinnedIds.has(msg.id);
            const who = msg.author_name || counterpartName;
            return (
              <div key={msg.id} className={`group flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  <span className="text-[12px] font-semibold text-foreground">{isOwn ? 'You' : who}</span>
                  <span className="text-[11px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                  <button
                    onClick={() => onPin(msg, isOwn ? 'your' : who)}
                    disabled={pinningId === msg.id || isPinned}
                    className={`transition-opacity p-0.5 rounded ${isPinned ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
                    title={isPinned ? 'Added to deal notes' : 'Add to deal notes'}
                  >
                    {isPinned ? <BookmarkSolidIcon className="h-3 w-3" /> : <BookmarkIcon className="h-3 w-3" strokeWidth={2} />}
                  </button>
                  {!isOwn && (
                    <button
                      onClick={() => onDelete(msg)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <TrashIcon className="h-3 w-3" strokeWidth={2} />
                    </button>
                  )}
                </div>
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isOwn ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm'}`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="rounded-2xl bg-secondary/50 border border-border/60 focus-within:border-primary/40 transition-colors flex flex-col">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          disabled={isSelf}
          className="w-full bg-transparent px-4 py-3 text-[14px] text-foreground focus:outline-none placeholder-muted-foreground resize-none disabled:opacity-60"
          placeholder={isSelf ? "This is your own application — you can't message yourself." : `Message ${counterpartName}…`}
        />
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          <span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for new line</span>
          <Button size="sm" className="rounded-xl h-8 px-3.5" loading={sending} disabled={!draft.trim() || isSelf} onClick={send}>
            <PaperAirplaneIcon className="h-3.5 w-3.5 mr-1" strokeWidth={2} />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
