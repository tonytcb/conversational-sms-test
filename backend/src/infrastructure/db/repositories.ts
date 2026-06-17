import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  ConversationRepository,
  InsertMessageInput,
  MessageEventRepository,
  MessageRepository,
  Repositories,
  TransactionRunner,
} from '../../domain/ports/repositories';
import type { ConversationRecord, ConversationSummary, MessageRecord } from '../../domain/types';
import type { Database } from './client';
import { conversations, messageEvents, messages, type ConversationRow, type MessageRow } from './schema';

// drizzle's transaction param has a distinct type but the same query surface.
type Executor = Database;

function mapConversation(r: ConversationRow): ConversationRecord {
  return {
    id: r.id,
    publicId: r.publicId,
    participantPhone: r.participantPhone,
    businessPhone: r.businessPhone,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapMessage(r: MessageRow): MessageRecord {
  return {
    id: r.id,
    publicId: r.publicId,
    conversationId: r.conversationId,
    direction: r.direction,
    providerSid: r.providerSid,
    idempotencyKey: r.idempotencyKey,
    body: r.body,
    status: r.status,
    replyToMessageId: r.replyToMessageId,
    processedAt: r.processedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}


function conversationRepo(ex: Executor): ConversationRepository {
  return {
    async upsert({ participantPhone, businessPhone, now }) {
      const rows = await ex
        .insert(conversations)
        .values({ participantPhone, businessPhone, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [conversations.participantPhone, conversations.businessPhone],
          set: { updatedAt: now },
        })
        .returning();
      return mapConversation(rows[0]!);
    },

    async touch(conversationId, at) {
      await ex.update(conversations).set({ updatedAt: at }).where(eq(conversations.id, conversationId));
    },

    async findById(id) {
      const rows = await ex.select().from(conversations).where(eq(conversations.id, id)).limit(1);
      return rows[0] ? mapConversation(rows[0]) : null;
    },

    async findByPublicId(publicId) {
      const rows = await ex.select().from(conversations).where(eq(conversations.publicId, publicId)).limit(1);
      return rows[0] ? mapConversation(rows[0]) : null;
    },

    async listSummaries({ limit }) {
      const convs = await ex
        .select()
        .from(conversations)
        .orderBy(desc(conversations.updatedAt))
        .limit(limit);
      if (convs.length === 0) return [];

      const ids = convs.map((c) => c.id);
      const msgs = await ex
        .select()
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(asc(messages.conversationId), asc(messages.createdAt), asc(messages.id));

      const byConv = new Map<number, MessageRow[]>();
      for (const m of msgs) {
        const list = byConv.get(m.conversationId) ?? [];
        list.push(m);
        byConv.set(m.conversationId, list);
      }

      return convs.map<ConversationSummary>((c) => {
        const list = byConv.get(c.id) ?? [];
        const last = list[list.length - 1];
        return {
          publicId: c.publicId,
          participantPhone: c.participantPhone,
          businessPhone: c.businessPhone,
          lastMessageAt: last ? last.createdAt : null, // derived from the last message
          messageCount: list.length,
          lastMessagePreview: last ? last.body : null,
          lastMessageDirection: last ? last.direction : null,
        };
      });
    },
  };
}

function messageRepo(ex: Executor): MessageRepository {
  return {
    async insertDedup(input: InsertMessageInput) {
      const rows = await ex
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          direction: input.direction,
          providerSid: input.providerSid,
          idempotencyKey: input.idempotencyKey ?? null,
          body: input.body,
          status: input.status,
          replyToMessageId: input.replyToMessageId ?? null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: messages.providerSid })
        .returning();

      if (rows[0]) return { message: mapMessage(rows[0]), inserted: true };

      // Conflict on provider_sid -> fetch the existing row.
      const existing = await ex
        .select()
        .from(messages)
        .where(eq(messages.providerSid, input.providerSid as string))
        .limit(1);
      return { message: mapMessage(existing[0]!), inserted: false };
    },

    async insertReplyIntent(input) {
      const rows = await ex
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          direction: 'outbound',
          providerSid: null,
          idempotencyKey: input.idempotencyKey,
          body: input.body,
          status: 'queued',
          replyToMessageId: input.replyToMessageId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        // partial unique on (reply_to_message_id) WHERE direction='outbound'
        .onConflictDoNothing({
          target: messages.replyToMessageId,
          where: sql`${messages.direction} = 'outbound'`,
        })
        .returning();

      if (rows[0]) return { message: mapMessage(rows[0]), inserted: true };

      // Another worker (or a prior attempt) already claimed the reply -> fetch it.
      const existing = await ex
        .select()
        .from(messages)
        .where(and(eq(messages.direction, 'outbound'), eq(messages.replyToMessageId, input.replyToMessageId)))
        .limit(1);
      return { message: mapMessage(existing[0]!), inserted: false };
    },

    async findById(id) {
      const rows = await ex.select().from(messages).where(eq(messages.id, id)).limit(1);
      return rows[0] ? mapMessage(rows[0]) : null;
    },
    async findByPublicId(publicId) {
      const rows = await ex.select().from(messages).where(eq(messages.publicId, publicId)).limit(1);
      return rows[0] ? mapMessage(rows[0]) : null;
    },
    async findByProviderSid(providerSid) {
      const rows = await ex.select().from(messages).where(eq(messages.providerSid, providerSid)).limit(1);
      return rows[0] ? mapMessage(rows[0]) : null;
    },
    async findReplyTo(inboundMessageId) {
      const rows = await ex
        .select()
        .from(messages)
        .where(and(eq(messages.direction, 'outbound'), eq(messages.replyToMessageId, inboundMessageId)))
        .limit(1);
      return rows[0] ? mapMessage(rows[0]) : null;
    },
    async findEarliestUnprocessedInbound(conversationId) {
      const rows = await ex
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.direction, 'inbound'),
            inArray(messages.status, ['received', 'processing']),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(1);
      return rows[0] ? mapMessage(rows[0]) : null;
    },
    async updateStatus({ id, status, providerSid, processedAt, now }) {
      const set: Partial<MessageRow> = { status, updatedAt: now };
      if (processedAt !== undefined) set.processedAt = processedAt;
      if (providerSid !== undefined) set.providerSid = providerSid;
      const rows = await ex.update(messages).set(set).where(eq(messages.id, id)).returning();
      return mapMessage(rows[0]!);
    },
    async listByConversationId(conversationId) {
      // chronological; id as the tiebreak
      const rows = await ex
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt), asc(messages.id));
      return rows.map(mapMessage);
    },
  };
}

function eventRepo(ex: Executor): MessageEventRepository {
  return {
    async append(input) {
      await ex.insert(messageEvents).values({
        messageId: input.messageId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        metadata: input.metadata ?? null,
        occurredAt: input.now,
      });
    },
  };
}

export function buildRepositories(ex: Executor): Repositories {
  return {
    conversations: conversationRepo(ex),
    messages: messageRepo(ex),
    events: eventRepo(ex),
  };
}

export class DrizzleTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Database) {}
  async run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(buildRepositories(tx as unknown as Executor)));
  }
}
