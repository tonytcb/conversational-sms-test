import type { Repositories, TransactionRunner } from '../domain/ports/repositories';
import type { Clock, DistributedLock, Logger, Sleeper, SmsProvider } from '../domain/ports/services';
import type { InboundSmsEvent, MessageRecord, MessageStatus } from '../domain/types';
import { generateReply } from '../domain/services/reply-generator';
import { isTerminal } from '../domain/value-objects/message-status';

export type ProcessOutcome =
  | { kind: 'processed'; messagePublicId: string }
  | { kind: 'duplicate'; messagePublicId: string }
  | { kind: 'requeue'; delayMs: number };

export interface ProcessInboundMessageDeps {
  txRunner: TransactionRunner;
  repos: Repositories;
  sms: SmsProvider;
  lock: DistributedLock;
  clock: Clock;
  sleeper: Sleeper;
  logger: Logger;
  config: {
    processingMinMs: number;
    processingMaxMs: number;
    lockTtlMs: number;
    requeueDelayMs: number;
    coalesceBurst: boolean; // batch a conversation's pending inbounds into one reply (hot-conversation throughput)
  };
}

// lock conversation -> persist (dedup) -> ensure next in order -> reply -> sent
export class ProcessInboundMessageUseCase {
  constructor(private readonly deps: ProcessInboundMessageDeps) {}

  async execute(event: InboundSmsEvent): Promise<ProcessOutcome> {
    const { lock, config } = this.deps;
    const lockKey = `conv:${event.to}:${event.from}`;
    const log = this.deps.logger.child({ providerSid: event.providerSid, correlationId: event.providerSid });

    // one in-flight message per conversation -> ordering
    const handle = await lock.acquire(lockKey, config.lockTtlMs);
    if (!handle) {
      log.debug({ lockKey }, 'conversation locked, requeueing');
      return { kind: 'requeue', delayMs: config.requeueDelayMs };
    }

    try {
      const { message, inserted } = await this.persistInbound(event);
      if (!inserted && isHandled(message)) {
        log.info({ messageId: message.publicId, status: message.status }, 'duplicate, already handled');
        return { kind: 'duplicate', messagePublicId: message.publicId };
      }

      // only the earliest unprocessed message goes; the rest wait their turn
      const head = await this.deps.repos.messages.findEarliestUnprocessedInbound(message.conversationId);
      if (head && head.id !== message.id) {
        log.debug({ headId: head.publicId, thisId: message.publicId }, 'not next in order, requeueing');
        return { kind: 'requeue', delayMs: config.requeueDelayMs };
      }

      await this.process(event, message, log);
      return { kind: 'processed', messagePublicId: message.publicId };
    } finally {
      await handle.release();
    }
  }

  private async persistInbound(event: InboundSmsEvent): Promise<{ message: MessageRecord; inserted: boolean }> {
    const now = this.deps.clock.now();
    const receivedAt = new Date(event.receivedAt);
    return this.deps.txRunner.run(async (repos) => {
      const conversation = await repos.conversations.upsert({
        participantPhone: event.from,
        businessPhone: event.to,
        now,
      });

      const existing = await repos.messages.findByProviderSid(event.providerSid);
      if (existing) return { message: existing, inserted: false };

      const { message } = await repos.messages.insertDedup({
        conversationId: conversation.id,
        seq: event.seq, // receive-order sequence, allocated on the hot path
        direction: 'inbound',
        providerSid: event.providerSid,
        body: event.body,
        status: 'received',
        now: receivedAt, // createdAt = received time, legacy ordering fallback
      });
      await repos.events.append({
        messageId: message.id,
        fromStatus: null,
        toStatus: 'received',
        metadata: { from: event.from, to: event.to },
        now,
      });
      await repos.conversations.touch(conversation.id, receivedAt);
      return { message, inserted: true };
    });
  }

  private async process(event: InboundSmsEvent, inbound: MessageRecord, log: Logger): Promise<void> {
    // Hot-conversation throughput: under burst coalescing, answer all of a conversation's
    // pending inbounds with ONE reply. We hold the conversation lock, so the batch is stable.
    // The reply links to the latest message in the batch (highest seq); the others are marked
    // sent without their own reply. Off -> batch is just [inbound] (one reply per message).
    const batch = this.deps.config.coalesceBurst
      ? await this.deps.repos.messages.listUnprocessedInbound(inbound.conversationId)
      : [inbound];
    const target = batch[batch.length - 1] ?? inbound; // latest seq answers the burst

    for (const m of batch) {
      if (m.status === 'received') await this.transition(m.id, 'received', 'processing');
    }

    const delayMs = this.randomDelay();
    log.info({ messageId: target.publicId, batchSize: batch.length, delayMs }, 'processing message');
    await this.deps.sleeper.sleep(delayMs);

    const replyBody = generateReply(batch.map((m) => m.body).join('\n'));
    const idempotencyKey = `reply:${target.id}`;

    // 1. claim the right to reply, before any send. UNIQUE(reply_to) makes this idempotent:
    //    a racing worker or a retry gets the already-claimed row back.
    const intent = await this.claimReplyIntent(target, replyBody, idempotencyKey);

    // 2. a prior attempt already finalized the send -> only ensure the batch is marked sent.
    if (intent.status !== 'queued') {
      await this.markBatchSent(batch);
      log.info({ replyId: intent.publicId }, 'reply already sent, skipping');
      return;
    }

    // 3. send with the deterministic key (provider dedups a retried send -> no double-text).
    const sent = await this.deps.sms.send({ to: event.from, from: event.to, body: replyBody, idempotencyKey });

    // 4. finalize: queued -> sent on the reply, mark every batched inbound sent, audit all.
    await this.finalizeReply(target, intent.id, sent.providerSid, batch);
    log.info({ providerSid: sent.providerSid, batchSize: batch.length }, 'reply sent');
  }

  // persist the outbound reply intent (status=queued, provider_sid=null) before the send
  private async claimReplyIntent(inbound: MessageRecord, body: string, idempotencyKey: string): Promise<MessageRecord> {
    const now = this.deps.clock.now();
    return this.deps.txRunner.run(async (repos) => {
      const { message, inserted } = await repos.messages.insertReplyIntent({
        conversationId: inbound.conversationId,
        replyToMessageId: inbound.id,
        idempotencyKey,
        body,
        now,
      });
      if (inserted) {
        await repos.events.append({
          messageId: message.id,
          fromStatus: null,
          toStatus: 'queued',
          metadata: { replyTo: inbound.publicId },
          now,
        });
      }
      return message;
    });
  }

  // one tx: finalize the outbound reply (queued -> sent + provider_sid) AND mark every batched inbound sent
  private async finalizeReply(
    target: MessageRecord,
    replyId: number,
    providerSid: string,
    batch: MessageRecord[],
  ): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.txRunner.run(async (repos) => {
      await repos.messages.updateStatus({ id: replyId, status: 'sent', providerSid, processedAt: now, now });
      await repos.events.append({ messageId: replyId, fromStatus: 'queued', toStatus: 'sent', now });
      for (const m of batch) {
        await repos.messages.updateStatus({ id: m.id, status: 'sent', processedAt: now, now });
        await repos.events.append({ messageId: m.id, fromStatus: 'processing', toStatus: 'sent', now });
      }
      await repos.conversations.touch(target.conversationId, now);
    });
  }

  // idempotent: mark every batched inbound sent if a prior attempt already sent the reply
  private async markBatchSent(batch: MessageRecord[]): Promise<void> {
    const pending = batch.filter((m) => m.status !== 'sent');
    if (pending.length === 0) return;
    const now = this.deps.clock.now();
    await this.deps.txRunner.run(async (repos) => {
      for (const m of pending) {
        await repos.messages.updateStatus({ id: m.id, status: 'sent', processedAt: now, now });
        await repos.events.append({ messageId: m.id, fromStatus: m.status, toStatus: 'sent', now });
      }
    });
  }

  private async transition(messageId: number, from: MessageStatus, to: MessageStatus, processedAt?: Date): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.txRunner.run(async (repos) => {
      await repos.messages.updateStatus({ id: messageId, status: to, processedAt: processedAt ?? null, now });
      await repos.events.append({ messageId, fromStatus: from, toStatus: to, now });
    });
  }

  private randomDelay(): number {
    const { processingMinMs, processingMaxMs } = this.deps.config;
    return processingMinMs + Math.floor(Math.random() * (processingMaxMs - processingMinMs + 1));
  }
}

function isHandled(message: MessageRecord): boolean {
  return message.status === 'sent' || isTerminal(message.status);
}
