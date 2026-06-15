import { NotFoundError } from '../domain/errors';
import type { Repositories } from '../domain/ports/repositories';
import {
  toConversationDTO,
  toConversationSummaryDTO,
  toMessageDTO,
  type ConversationDTO,
  type ConversationSummaryDTO,
  type MessageDTO,
} from './dto';

/** Read-side use cases for the admin API. Thin: fetch records, map to DTOs. */
export class Queries {
  constructor(private readonly repos: Repositories) {}

  async listConversations(input: { limit: number }): Promise<ConversationSummaryDTO[]> {
    const summaries = await this.repos.conversations.listSummaries({ limit: input.limit });
    return summaries.map(toConversationSummaryDTO);
  }

  async getConversation(
    publicId: string,
  ): Promise<{ conversation: ConversationDTO; messages: MessageDTO[] }> {
    const conversation = await this.repos.conversations.findByPublicId(publicId);
    if (!conversation) throw new NotFoundError(`Conversation ${publicId} not found`);
    const messages = await this.repos.messages.listByConversationId(conversation.id);
    return {
      conversation: toConversationDTO(conversation),
      messages: messages.map(toMessageDTO),
    };
  }
}
