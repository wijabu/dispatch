import type { RefreshState } from "@/lib/refresh";

const STATE_CLASSES: Record<RefreshState, string> = {
  upcoming: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  due: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
};

export function RefreshBadge({
  state,
  token,
  title,
}: {
  state: RefreshState;
  token: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_CLASSES[state]}`}
    >
      ↻ {token}
    </span>
  );
}
