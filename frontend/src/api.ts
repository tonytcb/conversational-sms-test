import type { Conversation, ConversationSummary, Message } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  listConversations: () =>
    getJson<{ conversations: ConversationSummary[] }>('/api/v1/conversations').then((d) => d.conversations),

  getConversation: (id: string) =>
    getJson<{ conversation: Conversation; messages: Message[] }>(`/api/v1/conversations/${id}`),
};
