import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  openLiveStream,
  type ChatMessage,
  type Conversation,
  type LiveEvent,
} from './api';
import { timeAgo } from './ui';

const displayName = (c: Conversation) => c.customerName || (c.username ? `@${c.username}` : `Chat ${c.id}`);

const byRecent = (a: Conversation, b: Conversation) =>
  new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime();

function upsertMessage(list: ChatMessage[], msg: ChatMessage) {
  return list.some((m) => m.id === msg.id) ? list : [...list, msg];
}

const SENDER_LABEL = { USER: 'Customer', ASSISTANT: '🤖 AI assistant', AGENT: '👤 You (agent)', SYSTEM: 'System' } as const;

export default function Conversations() {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const selectedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected = convos.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const handleLive = useCallback((event: LiveEvent) => {
    if (event.type === 'message') {
      const isOpen = selectedRef.current === event.conversation.id;
      const incoming = isOpen ? { ...event.conversation, unreadCount: 0 } : event.conversation;
      setConvos((prev) => [incoming, ...prev.filter((c) => c.id !== incoming.id)].sort(byRecent));
      if (isOpen) {
        setMessages((prev) => upsertMessage(prev, event.message));
        if (event.message.senderType === 'USER') api.markRead(incoming.id).catch(() => undefined);
      }
    } else if (event.type === 'mode') {
      setConvos((prev) => prev.map((c) => (c.id === event.conversationId ? { ...c, isHumanMode: event.isHumanMode } : c)));
    }
  }, []);

  useEffect(() => {
    api.conversations().then((r) => setConvos(r.data)).catch((e) => setError(e.message));
    return openLiveStream(handleLive, setConnected);
  }, [handleLive]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedId]);

  async function open(id: string) {
    setSelectedId(id);
    setMessages([]);
    setError('');
    setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    try {
      const [m] = await Promise.all([api.messages(id), api.markRead(id)]);
      if (selectedRef.current === id) setMessages(m.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    }
  }

  async function setMode(humanMode: boolean) {
    if (!selected || selected.isHumanMode === humanMode) return;
    setToggling(true);
    setError('');
    try {
      const { data } = await api.toggleMode(selected.id, humanMode);
      setConvos((prev) => prev.map((c) => (c.id === data.id ? { ...c, isHumanMode: data.isHumanMode } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch mode');
    } finally {
      setToggling(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!selected || !text || sending) return;
    setSending(true);
    setError('');
    try {
      const { data } = await api.reply(selected.id, text);
      setMessages((prev) => upsertMessage(prev, data));
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  const humanMode = selected?.isHumanMode ?? false;

  return (
    <div className="convo">
      <aside className="convo-list" aria-label="Telegram conversations">
        <div className="convo-list-header">
          <h2>Live chats</h2>
          <span className={`live ${connected ? 'on' : ''}`}><i />{connected ? 'Live' : 'Offline'}</span>
        </div>
        {convos.length === 0 && <div className="empty">No Telegram conversations yet.</div>}
        {convos.map((c) => (
          <button
            key={c.id}
            id={`conversation-${c.id}`}
            className={`convo-item ${c.id === selectedId ? 'active' : ''} ${c.unreadCount > 0 ? 'unread' : ''}`}
            onClick={() => open(c.id)}
          >
            <div className="avatar">{displayName(c)[0]?.toUpperCase()}</div>
            <div className="body">
              <div className="row">
                <span className="name">{displayName(c)}</span>
                <span className="time">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <div className="row">
                <span className="preview">{c.lastMessagePreview}</span>
                {c.unreadCount > 0
                  ? <span className="badge unread">{c.unreadCount}</span>
                  : <span className="mode-dot" title={c.isHumanMode ? 'Human mode' : 'AI mode'}>{c.isHumanMode ? '👤' : '🤖'}</span>}
              </div>
            </div>
          </button>
        ))}
      </aside>

      <section className="thread">
        {!selected ? (
          <div className="placeholder">
            <div>
              <div className="big">💬</div>
              <h3>Select a conversation</h3>
              <p>Pick a Telegram customer on the left to read the thread or take over from the AI.</p>
            </div>
          </div>
        ) : (
          <>
            <header className="thread-header">
              <div>
                <h3>{displayName(selected)}</h3>
                <small>{selected.username ? `@${selected.username} · ` : ''}Telegram chat {selected.id}</small>
              </div>
              <div className="mode-toggle" role="group" aria-label="Conversation mode">
                <button id="mode-ai" className={!humanMode ? 'on' : ''} disabled={toggling} onClick={() => setMode(false)}>🤖 AI Mode</button>
                <button id="mode-human" className={humanMode ? 'on human' : ''} disabled={toggling} onClick={() => setMode(true)}>👤 Human Mode</button>
              </div>
            </header>

            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.senderType.toLowerCase()}`}>
                  <div className="bubble">{m.content}</div>
                  <div className="meta">
                    {SENDER_LABEL[m.senderType]} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {error && <div className="error-box" style={{ margin: '0 24px 12px' }}>{error}</div>}

            <form className="composer" onSubmit={send}>
              <textarea
                id="reply-input"
                className="field"
                rows={1}
                value={draft}
                disabled={!humanMode || sending}
                placeholder={humanMode ? 'Type a reply — sent directly to the customer on Telegram…' : 'Switch to Human Mode to reply'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button id="reply-send" className="btn primary" disabled={!humanMode || sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </form>
            <div className="composer-hint">
              {humanMode ? 'Human Mode: the AI is paused for this customer.' : 'AI Mode: the assistant answers automatically.'}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
