import type { MessageStatus } from './types';

export const STATUS_COLORS: Record<MessageStatus, string> = {
  received: '#6b7280',
  processing: '#d97706',
  sent: '#2563eb',
  delivered: '#16a34a',
  failed: '#dc2626',
};

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
