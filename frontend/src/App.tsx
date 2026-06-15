import { useState } from 'react';
import { ConversationDetail } from './components/ConversationDetail';
import { ConversationList } from './components/ConversationList';

export function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>📨 SMS Admin</h1>
        <span className="muted small">conversation histories &amp; message status</span>
      </header>
      <div className="layout">
        <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
        <ConversationDetail conversationId={selectedId} />
      </div>
    </div>
  );
}
