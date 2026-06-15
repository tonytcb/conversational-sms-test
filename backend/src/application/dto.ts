import type { ConversationRecord, ConversationSummary, Direction, MessageRecord, MessageStatus } from '../domain/types';

// API DTOs — only publicId is exposed, never the internal numeric id

export interface MessageDTO {
  id: string; // public_id
  direction: Direction;
  body: string;
  status: MessageStatus;
  providerSid: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface ConversationDTO {
  id: string; // public_id
  participantPhone: string;
  businessPhone: string;
  createdAt: string;
}

export interface ConversationSummaryDTO {
  id: string; // public_id
  participantPhone: string;
  businessPhone: string;
  lastMessageAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageDirection: Direction | null;
}

export function toMessageDTO(m: MessageRecord): MessageDTO {
  return {
    id: m.publicId,
    direction: m.direction,
    body: m.body,
    status: m.status,
    providerSid: m.providerSid,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    processedAt: m.processedAt ? m.processedAt.toISOString() : null,
  };
}

export function toConversationDTO(c: ConversationRecord): ConversationDTO {
  return {
    id: c.publicId,
    participantPhone: c.participantPhone,
    businessPhone: c.businessPhone,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toConversationSummaryDTO(s: ConversationSummary): ConversationSummaryDTO {
  return {
    id: s.publicId,
    participantPhone: s.participantPhone,
    businessPhone: s.businessPhone,
    lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
    messageCount: s.messageCount,
    lastMessagePreview: s.lastMessagePreview,
    lastMessageDirection: s.lastMessageDirection,
  };
}
