import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatTime } from '../util';
import { StatusBadge } from './StatusBadge';

export function ConversationDetail({ conversationId }: { conversationId: string | null }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.getConversation(conversationId as string),
    enabled: conversationId !== null,
    refetchInterval: 2000, // watch processing -> sent transitions live
  });

  if (!conversationId) {
    return (
      <main className="detail empty">
        <p className="muted">Select a conversation</p>
      </main>
    );
  }
  if (isLoading) return <main className="detail"><p className="muted">Loading…</p></main>;
  if (isError || !data) return <main className="detail"><p className="error">Failed to load</p></main>;

  return (
    <main className="detail" data-testid="conversation-detail">
      <header className="detail-header">
        <h2>{data.conversation.participantPhone}</h2>
        <span className="muted small">via {data.conversation.businessPhone}</span>
      </header>
      <div className="messages" data-testid="messages">
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction}`} data-testid={`message-${m.direction}`}>
            <div className="bubble-body">{m.body}</div>
            <div className="bubble-meta">
              <StatusBadge status={m.status} />
              <span className="muted small">{formatTime(m.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
