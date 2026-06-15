import { InvalidInboundEventError } from '../domain/errors';
import type { InboundQueue, Logger } from '../domain/ports/services';
import type { InboundSmsEvent } from '../domain/types';
import { PhoneNumber } from '../domain/value-objects/phone-number';

export interface ReceiveInboundSmsDeps {
  queue: InboundQueue;
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

    const event: InboundSmsEvent = {
      providerSid,
      from: from.value,
      to: to.value,
      body: raw.body ?? '',
      receivedAt: raw.receivedAt,
    };

    // jobId = providerSid, so duplicate deliveries collapse at the queue
    await this.deps.queue.enqueue(event, { jobId: providerSid });
    this.deps.logger.info({ providerSid, from: event.from, to: event.to }, 'inbound SMS enqueued');

    return { providerSid };
  }
}
