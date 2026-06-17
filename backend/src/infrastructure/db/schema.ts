import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// BIGINT id internally (fast joins/sorts); UUID public_id is the only id on the API
export const directionEnum = pgEnum('message_direction', ['inbound', 'outbound']);
export const messageStatusEnum = pgEnum('message_status', [
  'received',
  'processing',
  'queued', // outbound reply intent persisted, before the provider confirms (exactly-once send)
  'sent',
  'delivered',
  'failed',
]);

export const conversations = pgTable(
  'conversations',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').defaultRandom().notNull(),
    participantPhone: text('participant_phone').notNull(),
    businessPhone: text('business_phone').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_public_id_uq').on(t.publicId),
    uniqueIndex('conversations_participant_business_uq').on(t.participantPhone, t.businessPhone),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').defaultRandom().notNull(),
    conversationId: bigint('conversation_id', { mode: 'number' })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: directionEnum('direction').notNull(),
    // Twilio MessageSid. UNIQUE -> idempotency key for duplicate deliveries.
    providerSid: text('provider_sid'),
    // Deterministic send idempotency key on outbound replies (exactly-once send).
    idempotencyKey: text('idempotency_key'),
    body: text('body').notNull(),
    status: messageStatusEnum('status').notNull(),
    // Links an outbound reply back to the inbound it answers (send idempotency).
    replyToMessageId: bigint('reply_to_message_id', { mode: 'number' }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_public_id_uq').on(t.publicId),
    uniqueIndex('messages_provider_sid_uq').on(t.providerSid),
    // exactly-once send: one outbound reply per inbound, one row per idempotency key
    uniqueIndex('messages_reply_to_uq')
      .on(t.replyToMessageId)
      .where(sql`${t.direction} = 'outbound'`),
    uniqueIndex('messages_idempotency_key_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    index('messages_status_idx').on(t.status),
  ],
);

// append-only: one row per status transition
export const messageEvents = pgTable(
  'message_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    messageId: bigint('message_id', { mode: 'number' })
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    fromStatus: messageStatusEnum('from_status'),
    toStatus: messageStatusEnum('to_status').notNull(),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('message_events_message_idx').on(t.messageId, t.occurredAt)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
