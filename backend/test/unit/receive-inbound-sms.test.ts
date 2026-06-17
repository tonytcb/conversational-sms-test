import { describe, expect, it } from 'vitest';
import { ReceiveInboundSmsUseCase } from '../../src/application/receive-inbound-sms';
import { InvalidInboundEventError } from '../../src/domain/errors';
import { FakeQueue, FakeSequenceAllocator, silentLogger } from '../support/fakes';

function build() {
  const queue = new FakeQueue();
  const seqAllocator = new FakeSequenceAllocator();
  const uc = new ReceiveInboundSmsUseCase({ queue, seqAllocator, logger: silentLogger });
  return { uc, queue };
}

const base = {
  providerSid: 'SM123',
  from: '+15551230000',
  to: '+15550000000',
  body: 'hello',
  receivedAt: '2026-06-12T12:00:00.000Z',
};

describe('ReceiveInboundSmsUseCase (hot path)', () => {
  it('enqueues a valid inbound with jobId = providerSid', async () => {
    const { uc, queue } = build();
    await uc.execute(base);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]!.opts?.jobId).toBe('SM123');
    expect(queue.enqueued[0]!.event.from).toBe('+15551230000');
    expect(queue.enqueued[0]!.event.seq).toBe(1); // receive-order seq allocated on the hot path
  });

  it('allocates a monotonic per-conversation seq across deliveries', async () => {
    const { uc, queue } = build();
    await uc.execute(base);
    await uc.execute({ ...base, providerSid: 'SM124' });
    expect(queue.enqueued.map((e) => e.event.seq)).toEqual([1, 2]);
  });

  const invalidCases = [
    { name: 'missing sid', input: { ...base, providerSid: '' } },
    { name: 'bad from', input: { ...base, from: '12345' } },
    { name: 'bad to', input: { ...base, to: 'not-a-phone' } },
  ];
  it.each(invalidCases)('rejects $name', async ({ input }) => {
    const { uc, queue } = build();
    await expect(uc.execute(input)).rejects.toBeInstanceOf(InvalidInboundEventError);
    expect(queue.enqueued).toHaveLength(0);
  });
});
