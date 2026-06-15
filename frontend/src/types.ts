export type Direction = 'inbound' | 'outbound';
export type MessageStatus = 'received' | 'processing' | 'sent' | 'delivered' | 'failed';

export interface ConversationSummary {
  id: string;
  participantPhone: string;
  businessPhone: string;
  lastMessageAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageDirection: Direction | null;
}

export interface Message {
  id: string;
  direction: Direction;
  body: string;
  status: MessageStatus;
  providerSid: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface Conversation {
  id: string;
  participantPhone: string;
  businessPhone: string;
  createdAt: string;
}
