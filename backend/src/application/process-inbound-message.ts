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
  config: { processingMinMs: number; processingMaxMs: number; lockTtlMs: number; requeueDelayMs: number };
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
        direction: 'inbound',
        providerSid: event.providerSid,
        body: event.body,
        status: 'received',
        now: receivedAt, // createdAt = received time, used for ordering
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
    if (inbound.status === 'received') {
      await this.transition(inbound.id, 'received', 'processing');
    }

    const delayMs = this.randomDelay();
    log.info({ messageId: inbound.publicId, delayMs }, 'processing message');
    await this.deps.sleeper.sleep(delayMs);

    const replyBody = generateReply(inbound.body);

    // don't resend if a reply already went out (retry self-heal)
    const existingReply = await this.deps.repos.messages.findReplyTo(inbound.id);
    if (existingReply) {
      await this.transition(inbound.id, 'processing', 'sent', new Date());
      log.info({ replyId: existingReply.publicId }, 'reply already sent, skipping');
      return;
    }

    const sent = await this.deps.sms.send({ to: event.from, from: event.to, body: replyBody });
    await this.recordReply(inbound, replyBody, sent.providerSid);
    log.info({ providerSid: sent.providerSid }, 'reply sent');
  }

  // one tx: persist the outbound reply AND mark the inbound sent
  private async recordReply(inbound: MessageRecord, body: string, providerSid: string): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.txRunner.run(async (repos) => {
      const { message } = await repos.messages.insertDedup({
        conversationId: inbound.conversationId,
        direction: 'outbound',
        providerSid,
        body,
        status: 'sent',
        replyToMessageId: inbound.id,
        now,
      });
      await repos.events.append({
        messageId: message.id,
        fromStatus: null,
        toStatus: 'sent',
        metadata: { replyTo: inbound.publicId },
        now,
      });
      await repos.messages.updateStatus({ id: inbound.id, status: 'sent', processedAt: now, now });
      await repos.events.append({ messageId: inbound.id, fromStatus: 'processing', toStatus: 'sent', now });
      await repos.conversations.touch(inbound.conversationId, now);
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
