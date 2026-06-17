export type Direction = 'inbound' | 'outbound';

export type MessageStatus = 'received' | 'processing' | 'queued' | 'sent' | 'delivered' | 'failed';

// what the webhook puts on the queue
export interface InboundSmsEvent {
  providerSid: string; // Twilio MessageSid — idempotency key
  from: string; // customer phone (E.164)
  to: string; // our business phone (E.164)
  body: string;
  receivedAt: string;
}

// internal records — numeric id stays inside, never hits the API
export interface ConversationRecord {
  id: number;
  publicId: string;
  participantPhone: string;
  businessPhone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: number;
  publicId: string;
  conversationId: number;
  direction: Direction;
  providerSid: string | null;
  idempotencyKey: string | null;
  body: string;
  status: MessageStatus;
  replyToMessageId: number | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageEventRecord {
  id: number;
  messageId: number;
  fromStatus: MessageStatus | null;
  toStatus: MessageStatus;
  metadata: unknown;
  occurredAt: Date;
}

export interface ConversationSummary {
  publicId: string;
  participantPhone: string;
  businessPhone: string;
  lastMessageAt: Date | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageDirection: Direction | null;
}
