import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessInboundMessageUseCase } from '../../src/application/process-inbound-message';
import type { InboundSmsEvent } from '../../src/domain/types';
import {
  FakeClock,
  FakeLock,
  FakeSleeper,
  FakeSmsProvider,
  InMemoryRepositories,
  silentLogger,
} from '../support/fakes';

const config = { processingMinMs: 0, processingMaxMs: 0, lockTtlMs: 30000, requeueDelayMs: 500 };

function build() {
  const repos = new InMemoryRepositories();
  const sms = new FakeSmsProvider();
  const lock = new FakeLock();
  const uc = new ProcessInboundMessageUseCase({
    txRunner: repos,
    repos,
    sms,
    lock,
    clock: new FakeClock(),
    sleeper: new FakeSleeper(),
    logger: silentLogger,
    config,
  });
  return { uc, repos, sms, lock };
}

function event(overrides: Partial<InboundSmsEvent> = {}): InboundSmsEvent {
  return {
    providerSid: 'SMin1',
    from: '+15551230000',
    to: '+15550000000',
    body: 'hello there',
    receivedAt: '2026-06-12T12:00:00.000Z',
    ...overrides,
  };
}

async function seedInbound(
  repos: InMemoryRepositories,
  opts: { providerSid: string; body: string; status: 'received' | 'processing'; receivedAt: string },
) {
  const now = new Date(opts.receivedAt);
  const conv = await repos.conversations.upsert({
    participantPhone: '+15551230000',
    businessPhone: '+15550000000',
    now,
  });
  const { message } = await repos.messages.insertDedup({
    conversationId: conv.id,
    direction: 'inbound',
    providerSid: opts.providerSid,
    body: opts.body,
    status: opts.status,
    now,
  });
  return { conv, message };
}

describe('ProcessInboundMessageUseCase', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('persists inbound, sends a reply, records the audit trail', async () => {
    const out = await ctx.uc.execute(event());
    expect(out.kind).toBe('processed');

    const inbound = ctx.repos.messagesData.find((m) => m.direction === 'inbound')!;
    const outbound = ctx.repos.messagesData.find((m) => m.direction === 'outbound')!;
    expect(inbound.status).toBe('sent');
    expect(outbound.status).toBe('sent');
    expect(outbound.replyToMessageId).toBe(inbound.id);
    expect(ctx.sms.sent).toHaveLength(1);
    expect(ctx.sms.sent[0]!.to).toBe('+15551230000');

    const inboundEvents = ctx.repos.eventsData.filter((e) => e.messageId === inbound.id).map((e) => e.toStatus);
    expect(inboundEvents).toEqual(['received', 'processing', 'sent']);
  });

  it('treats a duplicate delivery of an already-handled message as duplicate', async () => {
    await ctx.uc.execute(event());
    const out = await ctx.uc.execute(event());
    expect(out.kind).toBe('duplicate');
    expect(ctx.repos.messagesData).toHaveLength(2);
    expect(ctx.sms.sent).toHaveLength(1);
  });

  it('requeues (without processing) when the conversation lock is held', async () => {
    ctx.lock.available = false;
    const out = await ctx.uc.execute(event());
    expect(out).toEqual({ kind: 'requeue', delayMs: 500 });
    expect(ctx.repos.messagesData).toHaveLength(0);
  });

  it('requeues a message that is not next in order (ordering)', async () => {
    await seedInbound(ctx.repos, {
      providerSid: 'SMearlier',
      body: 'first',
      status: 'received',
      receivedAt: '2026-06-12T11:59:00.000Z',
    });
    const out = await ctx.uc.execute(event({ providerSid: 'SMlater', receivedAt: '2026-06-12T12:00:00.000Z' }));
    expect(out).toEqual({ kind: 'requeue', delayMs: 500 });
    const later = ctx.repos.messagesData.find((m) => m.providerSid === 'SMlater')!;
    expect(later.status).toBe('received'); // persisted but not processed
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('outbound reply goes queued -> sent, carrying provider_sid and the idempotency key', async () => {
    await ctx.uc.execute(event());
    const inbound = ctx.repos.messagesData.find((m) => m.direction === 'inbound')!;
    const outbound = ctx.repos.messagesData.find((m) => m.direction === 'outbound')!;

    expect(outbound.status).toBe('sent');
    expect(outbound.providerSid).toBe('SMout1');
    expect(outbound.idempotencyKey).toBe(`reply:${inbound.id}`);

    const outEvents = ctx.repos.eventsData.filter((e) => e.messageId === outbound.id).map((e) => e.toStatus);
    expect(outEvents).toEqual(['queued', 'sent']); // intent persisted before the send
    expect(ctx.sms.sent[0]!.idempotencyKey).toBe(`reply:${inbound.id}`);
  });

  it('exactly-once: a retried send after a finalize crash never double-texts', async () => {
    const ev = event({ providerSid: 'SMcrash' });
    const now = new Date(ev.receivedAt);

    // Reconstruct the post-crash state: inbound processing, reply intent queued, and the
    // pre-crash send already reached the provider — but finalize never committed.
    const conv = await ctx.repos.conversations.upsert({ participantPhone: ev.from, businessPhone: ev.to, now });
    const { message: inbound } = await ctx.repos.messages.insertDedup({
      conversationId: conv.id,
      direction: 'inbound',
      providerSid: ev.providerSid,
      body: ev.body,
      status: 'processing',
      now,
    });
    const key = `reply:${inbound.id}`;
    await ctx.repos.messages.insertReplyIntent({
      conversationId: conv.id,
      replyToMessageId: inbound.id,
      idempotencyKey: key,
      body: 'reply',
      now,
    });
    await ctx.sms.send({ to: ev.from, from: ev.to, body: 'reply', idempotencyKey: key });
    expect(ctx.sms.calls).toBe(1);

    // The job is retried.
    const out = await ctx.uc.execute(ev);
    expect(out.kind).toBe('processed');

    expect(ctx.sms.calls).toBe(2); // we did call the provider again...
    expect(ctx.sms.sent).toHaveLength(1); // ...but the idempotency key deduped it -> ONE text
    const replies = ctx.repos.messagesData.filter((m) => m.direction === 'outbound');
    expect(replies).toHaveLength(1); // UNIQUE(reply_to) -> still one reply row
    expect(replies[0]!.status).toBe('sent');
    expect(ctx.repos.messagesData.find((m) => m.id === inbound.id)!.status).toBe('sent');
  });

  it('does not resend if a reply already exists (retry safety)', async () => {
    const { message: inbound } = await seedInbound(ctx.repos, {
      providerSid: 'SMy',
      body: 'hi',
      status: 'processing',
      receivedAt: '2026-06-12T12:00:00.000Z',
    });
    await ctx.repos.messages.insertDedup({
      conversationId: inbound.conversationId,
      direction: 'outbound',
      providerSid: 'SMoutPrev',
      body: 'prev reply',
      status: 'sent',
      replyToMessageId: inbound.id,
      now: new Date('2026-06-12T12:00:01.000Z'),
    });

    const out = await ctx.uc.execute(event({ providerSid: 'SMy' }));
    expect(out.kind).toBe('processed');
    expect(ctx.sms.sent).toHaveLength(0);
    expect(ctx.repos.messagesData.find((m) => m.id === inbound.id)!.status).toBe('sent');
  });
});
