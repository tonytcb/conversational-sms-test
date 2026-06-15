import { describe, expect, it } from 'vitest';
import { Queries } from '../../src/application/queries';
import { NotFoundError } from '../../src/domain/errors';
import { InMemoryRepositories } from '../support/fakes';

async function seedConversation(repos: InMemoryRepositories) {
  const now = new Date('2026-06-12T12:00:00.000Z');
  const conv = await repos.conversations.upsert({
    participantPhone: '+15551230000',
    businessPhone: '+15550000000',
    now,
  });
  await repos.messages.insertDedup({
    conversationId: conv.id,
    direction: 'inbound',
    providerSid: 'SMin1',
    body: 'hello',
    status: 'sent',
    now,
  });
  await repos.conversations.touch(conv.id, now);
  return conv;
}

describe('Queries', () => {
  it('lists conversation summaries with counts and previews', async () => {
    const repos = new InMemoryRepositories();
    await seedConversation(repos);
    const list = await new Queries(repos).listConversations({ limit: 50 });
    expect(list).toHaveLength(1);
    expect(list[0]!.messageCount).toBe(1);
    expect(list[0]!.lastMessagePreview).toBe('hello');
    expect(list[0]).not.toHaveProperty('conversationId'); // no internal ids leak
  });

  it('returns a conversation with its messages by publicId', async () => {
    const repos = new InMemoryRepositories();
    const conv = await seedConversation(repos);
    const res = await new Queries(repos).getConversation(conv.publicId);
    expect(res.conversation.id).toBe(conv.publicId);
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]!.id).toMatch(/^msg-/);
  });

  it('throws NotFoundError for an unknown conversation', async () => {
    const repos = new InMemoryRepositories();
    await expect(new Queries(repos).getConversation('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
