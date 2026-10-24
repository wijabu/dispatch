"use client";

import { useState, useTransition } from "react";
import { dropAndPush, refreshAfterDrop } from "@/lib/automation-actions";
import { snoozeItem } from "@/lib/actions";
import type { DropPushResult, PushMode } from "@/lib/drop-push-core";
import { formatPrice } from "@/lib/format";

const CHANNEL_LABELS: Record<string, string> = {
  offerup: "OfferUp",
  facebook: "Facebook",
  craigslist: "Craigslist",
  "reddit-watchexchange": "Reddit r/Watchexchange",
  watchuseek: "Watchuseek",
  item: "Item",
  emulator: "Emulator",
};

const OUTCOME_ICON: Record<DropPushResult["channels"][number]["outcome"], string> = {
  repriced: "✓",
  relisted: "✓",
  failed: "⚠️",
  manual: "○",
};

const BUTTON =
  "rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50";

// Same look as TaskSection's SnoozeButton.
const SNOOZE =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800";

// The homepage drop task's actions. Results stay on screen until OK, because
// refreshing the page removes the (no longer due) drop task and this row.
// Snooze lives here (idle state only): Next runs Server Actions one at a time
// per client, so a Snooze clicked mid-drop would queue behind it and its
// revalidate would wipe the unread result.
export function DropTaskActions({
  itemId,
  targetPrice,
  autoChannels,
}: {
  itemId: number;
  targetPrice: number;
  autoChannels: string[];
}) {
  const [result, setResult] = useState<DropPushResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(mode: PushMode) {
    startTransition(async () => {
      setResult(await dropAndPush(itemId, mode));
    });
  }

  function acknowledge() {
    startTransition(async () => {
      await refreshAfterDrop(itemId);
      setResult(null);
    });
  }

  function snooze() {
    startTransition(async () => {
      await snoozeItem(itemId);
    });
  }

  if (result) {
    return (
      <div className="space-y-1 text-xs">
        {result.newPrice != null && (
          <div className="font-medium">Dropped to {formatPrice(result.newPrice)}</div>
        )}
        {result.channels.length === 0 && (
          <div className="text-zinc-500">No live listings to update.</div>
        )}
        {result.channels.map((c) => (
          <div
            key={c.channel}
            className={c.outcome === "failed" ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}
          >
            {c.outcome === "manual"
              ? `${OUTCOME_ICON[c.outcome]} ${CHANNEL_LABELS[c.channel] ?? c.channel}: ${c.detail ?? ""}`
              : `${OUTCOME_ICON[c.outcome]} ${CHANNEL_LABELS[c.channel] ?? c.channel} ${c.outcome}${c.detail ? `: ${c.detail}` : ""}`}
          </div>
        ))}
        <button
          type="button"
          disabled={isPending}
          onClick={acknowledge}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          OK
        </button>
      </div>
    );
  }

  if (isPending) {
    return (
      <span className="text-xs text-zinc-500">
        {autoChannels.length > 0
          ? "Working… (emulator). Other Dispatch actions wait until this finishes."
          : "Working…"}
      </span>
    );
  }

  const price = formatPrice(targetPrice);
  return (
    <>
      {autoChannels.length > 0 ? (
        <>
          <button type="button" onClick={() => run("reprice")} className={BUTTON}>
            Drop to {price} + reprice
          </button>
          <button type="button" onClick={() => run("relist")} className={BUTTON}>
            Drop to {price} + relist
          </button>
        </>
      ) : (
        <button type="button" onClick={() => run("reprice")} className={BUTTON}>
          Drop to {price}
        </button>
      )}
      <button type="button" onClick={snooze} className={SNOOZE}>
        Snooze 7d
      </button>
    </>
  );
}
