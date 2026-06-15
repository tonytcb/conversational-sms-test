import type { MessageStatus } from '../types';

// inbound: received -> processing -> sent ; outbound: sent
export const TERMINAL_STATUSES: ReadonlySet<MessageStatus> = new Set(['delivered', 'failed']);

export function isTerminal(status: MessageStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
