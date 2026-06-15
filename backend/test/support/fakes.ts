import type {
  ConversationRepository,
  InsertMessageInput,
  MessageEventRepository,
  MessageRepository,
  Repositories,
  TransactionRunner,
} from '../../src/domain/ports/repositories';
import type {
  Clock,
  DistributedLock,
  EnqueueOptions,
  InboundQueue,
  LockHandle,
  Logger,
  Sleeper,
  SmsProvider,
} from '../../src/domain/ports/services';
import type {
  ConversationRecord,
  ConversationSummary,
  InboundSmsEvent,
  MessageEventRecord,
  MessageRecord,
} from '../../src/domain/types';

/** A single in-memory data store that implements all three repositories. */
export class InMemoryRepositories implements Repositories, TransactionRunner {
  private convSeq = 0;
  private msgSeq = 0;
  private evtSeq = 0;
  readonly conversationsData: ConversationRecord[] = [];
  readonly messagesData: MessageRecord[] = [];
  readonly eventsData: MessageEventRecord[] = [];

  get conversations(): ConversationRepository {
    return {
      upsert: async ({ participantPhone, businessPhone, now }) => {
        let conv = this.conversationsData.find(
          (c) => c.participantPhone === participantPhone && c.businessPhone === businessPhone,
        );
        if (!conv) {
          conv = {
            id: ++this.convSeq,
            publicId: `conv-${this.convSeq}`,
            participantPhone,
            businessPhone,
            createdAt: now,
            updatedAt: now,
          };
          this.conversationsData.push(conv);
        }
        return { ...conv };
      },
      touch: async (conversationId, at) => {
        const conv = this.conversationsData.find((c) => c.id === conversationId);
        if (conv) conv.updatedAt = at;
      },
      findById: async (id) => {
        const c = this.conversationsData.find((x) => x.id === id);
        return c ? { ...c } : null;
      },
      findByPublicId: async (publicId) => {
        const c = this.conversationsData.find((x) => x.publicId === publicId);
        return c ? { ...c } : null;
      },
      listSummaries: async ({ limit }) => {
        const summaries: ConversationSummary[] = this.conversationsData.map((c) => {
          const msgs = this.messagesData
            .filter((m) => m.conversationId === c.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
          const last = msgs[msgs.length - 1];
          return {
            publicId: c.publicId,
            participantPhone: c.participantPhone,
            businessPhone: c.businessPhone,
            lastMessageAt: last ? last.createdAt : null,
            messageCount: msgs.length,
            lastMessagePreview: last ? last.body : null,
            lastMessageDirection: last ? last.direction : null,
          };
        });
        summaries.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
        return summaries.slice(0, limit);
      },
    };
  }

  get messages(): MessageRepository {
    return {
      insertDedup: async (input: InsertMessageInput) => {
        if (input.providerSid) {
          const existing = this.messagesData.find((m) => m.providerSid === input.providerSid);
          if (existing) return { message: { ...existing }, inserted: false };
        }
        const message: MessageRecord = {
          id: ++this.msgSeq,
          publicId: `msg-${this.msgSeq}`,
          conversationId: input.conversationId,
          direction: input.direction,
          providerSid: input.providerSid,
          body: input.body,
          status: input.status,
          replyToMessageId: input.replyToMessageId ?? null,
          processedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        };
        this.messagesData.push(message);
        return { message: { ...message }, inserted: true };
      },
      findById: async (id) => {
        const m = this.messagesData.find((x) => x.id === id);
        return m ? { ...m } : null;
      },
      findByPublicId: async (publicId) => {
        const m = this.messagesData.find((x) => x.publicId === publicId);
        return m ? { ...m } : null;
      },
      findByProviderSid: async (providerSid) => {
        const m = this.messagesData.find((x) => x.providerSid === providerSid);
        return m ? { ...m } : null;
      },
      findReplyTo: async (inboundMessageId) => {
        const m = this.messagesData.find(
          (x) => x.direction === 'outbound' && x.replyToMessageId === inboundMessageId,
        );
        return m ? { ...m } : null;
      },
      findEarliestUnprocessedInbound: async (conversationId) => {
        const candidates = this.messagesData
          .filter(
            (m) =>
              m.conversationId === conversationId &&
              m.direction === 'inbound' &&
              (m.status === 'received' || m.status === 'processing'),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
        return candidates[0] ? { ...candidates[0] } : null;
      },
      updateStatus: async ({ id, status, processedAt, now }) => {
        const m = this.messagesData.find((x) => x.id === id)!;
        m.status = status;
        if (processedAt !== undefined) m.processedAt = processedAt;
        m.updatedAt = now;
        return { ...m };
      },
      listByConversationId: async (conversationId) =>
        this.messagesData
          .filter((m) => m.conversationId === conversationId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
          .map((m) => ({ ...m })),
    };
  }

  get events(): MessageEventRepository {
    return {
      append: async (input) => {
        this.eventsData.push({
          id: ++this.evtSeq,
          messageId: input.messageId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          metadata: input.metadata ?? null,
          occurredAt: input.now,
        });
      },
    };
  }

  // TransactionRunner — no real isolation needed for the in-memory store.
  async run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-06-12T12:00:00.000Z')) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
}

export class FakeSleeper implements Sleeper {
  public calls: number[] = [];
  async sleep(ms: number): Promise<void> {
    this.calls.push(ms);
  }
}

export class FakeSmsProvider implements SmsProvider {
  public sent: { to: string; from: string; body: string }[] = [];
  public failNext = false;
  private seq = 0;
  async send(input: { to: string; from: string; body: string }): Promise<{ providerSid: string; status: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider send failed');
    }
    this.sent.push(input);
    return { providerSid: `SMout${++this.seq}`, status: 'queued' };
  }
}

export class FakeQueue implements InboundQueue {
  public enqueued: { event: InboundSmsEvent; opts?: EnqueueOptions }[] = [];
  async enqueue(event: InboundSmsEvent, opts?: EnqueueOptions): Promise<void> {
    this.enqueued.push({ event, opts });
  }
}

export class FakeLock implements DistributedLock {
  private held = new Set<string>();
  public available = true;
  async acquire(key: string): Promise<LockHandle | null> {
    if (!this.available || this.held.has(key)) return null;
    this.held.add(key);
    return {
      release: async () => {
        this.held.delete(key);
      },
    };
  }
}

export const silentLogger: Logger = {
  child: () => silentLogger,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
