import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatTime } from '../util';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ selectedId, onSelect }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['conversations'],
    queryFn: api.listConversations,
    refetchInterval: 3000, // poll for new conversations
  });

  return (
    <aside className="sidebar" data-testid="conversation-list">
      <h2>Conversations</h2>
      {isLoading && <p className="muted">Loading…</p>}
      {isError && <p className="error">Failed to load conversations</p>}
      {data?.length === 0 && <p className="muted">No conversations yet. Send an SMS to begin.</p>}
      <ul>
        {data?.map((c) => (
          <li
            key={c.id}
            className={c.id === selectedId ? 'conv selected' : 'conv'}
            data-testid="conversation-item"
            onClick={() => onSelect(c.id)}
          >
            <div className="conv-top">
              <span className="phone">{c.participantPhone}</span>
              <span className="muted small">{formatTime(c.lastMessageAt)}</span>
            </div>
            <div className="preview muted">
              {c.lastMessageDirection === 'outbound' ? '↩ ' : ''}
              {c.lastMessagePreview ?? '—'}
            </div>
            <div className="muted small">{c.messageCount} messages</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
