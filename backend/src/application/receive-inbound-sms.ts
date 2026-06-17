import { InvalidInboundEventError } from '../domain/errors';
import type { InboundQueue, Logger, SequenceAllocator } from '../domain/ports/services';
import type { InboundSmsEvent } from '../domain/types';
import { PhoneNumber } from '../domain/value-objects/phone-number';

export interface ReceiveInboundSmsDeps {
  queue: InboundQueue;
  seqAllocator: SequenceAllocator;
  logger: Logger;
}

export interface RawInboundSms {
  providerSid: string;
  from: string;
  to: string;
  body: string;
  receivedAt: string;
}

// hot path: runs in the webhook request, keep it to validate + enqueue (no DB)
export class ReceiveInboundSmsUseCase {
  constructor(private readonly deps: ReceiveInboundSmsDeps) {}

  async execute(raw: RawInboundSms): Promise<{ providerSid: string }> {
    const providerSid = (raw.providerSid ?? '').trim();
    if (!providerSid) {
      throw new InvalidInboundEventError('Missing MessageSid');
    }
    const from = PhoneNumber.parse(raw.from);
    const to = PhoneNumber.parse(raw.to);

    // allocate receive-order seq per conversation (one atomic Redis INCR, no DB)
    const seq = await this.deps.seqAllocator.next(`${to.value}:${from.value}`);

    const event: InboundSmsEvent = {
      providerSid,
      from: from.value,
      to: to.value,
      body: raw.body ?? '',
      receivedAt: raw.receivedAt,
      seq,
    };

    // jobId = providerSid, so duplicate deliveries collapse at the queue
    await this.deps.queue.enqueue(event, { jobId: providerSid });
    this.deps.logger.info({ providerSid, seq, from: event.from, to: event.to }, 'inbound SMS enqueued');

    return { providerSid };
  }
}
