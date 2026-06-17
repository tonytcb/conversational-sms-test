import type { ConversationRecord, ConversationSummary, Direction, MessageRecord, MessageStatus } from '../types';

export interface ConversationRepository {
  upsert(input: { participantPhone: string; businessPhone: string; now: Date }): Promise<ConversationRecord>;

  // bump updated_at so the conversation sorts to the top of the admin list
  touch(conversationId: number, at: Date): Promise<void>;

  findById(id: number): Promise<ConversationRecord | null>;
  findByPublicId(publicId: string): Promise<ConversationRecord | null>;

  listSummaries(input: { limit: number }): Promise<ConversationSummary[]>;
}

export interface InsertMessageInput {
  conversationId: number;
  seq?: number | null;
  direction: Direction;
  providerSid: string | null;
  idempotencyKey?: string | null;
  body: string;
  status: MessageStatus;
  replyToMessageId?: number | null;
  now: Date;
}

export interface InsertReplyIntentInput {
  conversationId: number;
  replyToMessageId: number;
  idempotencyKey: string;
  body: string;
  now: Date;
}

export interface MessageRepository {
  // ON CONFLICT(provider_sid) DO NOTHING; inserted=false means it was a duplicate
  insertDedup(input: InsertMessageInput): Promise<{ message: MessageRecord; inserted: boolean }>;

  // exactly-once send: persist the outbound reply intent (status=queued, provider_sid=null)
  // before calling the provider. ON CONFLICT(reply_to_message_id) DO NOTHING — a racing
  // worker or a retry gets inserted=false and the already-claimed row back.
  insertReplyIntent(input: InsertReplyIntentInput): Promise<{ message: MessageRecord; inserted: boolean }>;

  findById(id: number): Promise<MessageRecord | null>;
  findByPublicId(publicId: string): Promise<MessageRecord | null>;
  findByProviderSid(providerSid: string): Promise<MessageRecord | null>;

  // the outbound reply to a given inbound, if any (send idempotency)
  findReplyTo(inboundMessageId: number): Promise<MessageRecord | null>;

  // oldest received|processing inbound — the head that may be processed next
  findEarliestUnprocessedInbound(conversationId: number): Promise<MessageRecord | null>;

  updateStatus(input: {
    id: number;
    status: MessageStatus;
    providerSid?: string; // set when finalizing an outbound intent (queued -> sent)
    processedAt?: Date | null;
    now: Date;
  }): Promise<MessageRecord>;

  listByConversationId(conversationId: number): Promise<MessageRecord[]>;
}

export interface AppendEventInput {
  messageId: number;
  fromStatus: MessageStatus | null;
  toStatus: MessageStatus;
  metadata?: unknown;
  now: Date;
}

export interface MessageEventRepository {
  append(input: AppendEventInput): Promise<void>;
}

// repos bound to either the pool or an open transaction
export interface Repositories {
  conversations: ConversationRepository;
  messages: MessageRepository;
  events: MessageEventRepository;
}

// runs fn in one DB transaction with tx-bound repos
export interface TransactionRunner {
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
