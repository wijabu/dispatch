import type { ItemStatus } from "@/db/schema";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/format";

export function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
