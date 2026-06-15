import type { MessageStatus } from '../types';
import { STATUS_COLORS } from '../util';

export function StatusBadge({ status }: { status: MessageStatus }) {
  return (
    <span
      className="status-badge"
      data-testid="status-badge"
      style={{ backgroundColor: STATUS_COLORS[status] }}
    >
      {status}
    </span>
  );
}
