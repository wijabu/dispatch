"use client";

import { useState, useTransition } from "react";
import { SOLD_CHANNELS, type SoldChannel } from "@/db/schema";
import { markSoldAndTakedown, type SoldResult } from "@/lib/automation-actions";

const CHANNEL_LABELS: Record<SoldChannel, string> = {
  offerup: "OfferUp",
  facebook: "Facebook",
  craigslist: "Craigslist",
  "reddit-watchexchange": "Reddit r/Watchexchange",
  watchuseek: "Watchuseek",
  other: "Other",
};

const OUTCOME_ICON: Record<SoldResult["channels"][number]["outcome"], string> = {
  ended: "✓",
  failed: "⚠️",
  manual: "○",
  skipped: "–",
};

export function MarkSoldForm({
  itemId,
  defaultPrice,
  activePublishers,
}: {
  itemId: number;
  defaultPrice: number | null;
  activePublishers: string[]; // active listing channels, for the confirm summary
}) {
  const [price, setPrice] = useState(defaultPrice != null ? String(defaultPrice) : "");
  const [channel, setChannel] = useState<SoldChannel>("facebook");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SoldResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const auto = activePublishers.filter((p) => p === "offerup" || p === "facebook");
  const manual = activePublishers.filter((p) => p === "craigslist");
  const summary =
    (auto.length ? `Takes down ${auto.map((p) => CHANNEL_LABELS[p as SoldChannel]).join(" + ")} on the emulator. ` : "") +
    (manual.length ? "Flags Craigslist for manual delete." : "");

  function run() {
    startTransition(async () => {
      setResult(null);
      const parsed = price.trim() === "" ? null : Number(price);
      const res = await markSoldAndTakedown(itemId, Number.isFinite(parsed ?? NaN) ? parsed : null, channel);
      setResult(res);
      setConfirming(false);
    });
  }

  if (result) {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium">
          Sold at {result.soldPrice != null ? `$${result.soldPrice}` : "—"}
          {result.soldChannel ? ` on ${CHANNEL_LABELS[result.soldChannel]}` : ""}
        </div>
        {result.channels.length === 0 && <div className="text-zinc-500">No live listings to take down.</div>}
        {result.channels.map((c) => (
          <div key={c.channel} className={c.outcome === "failed" ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}>
            {OUTCOME_ICON[c.outcome]} {CHANNEL_LABELS[c.channel as SoldChannel] ?? c.channel} — {c.outcome}
            {c.detail ? ` (${c.detail})` : ""}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="soldPrice" className="mb-1 block text-xs text-zinc-500">Sold price ($)</label>
        <input
          id="soldPrice" type="number" step="any" min="0" value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={defaultPrice?.toString() ?? ""}
          className="w-28 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <div>
        <label htmlFor="soldChannel" className="mb-1 block text-xs text-zinc-500">Sold on</label>
        <select
          id="soldChannel" value={channel}
          onChange={(e) => setChannel(e.target.value as SoldChannel)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {SOLD_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
        </select>
      </div>
      {confirming ? (
        <div className="flex items-end gap-2">
          <button
            type="button" disabled={isPending} onClick={run}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Confirm sold"}
          </button>
          <button
            type="button" disabled={isPending} onClick={() => setConfirming(false)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          {summary && <span className="max-w-xs text-xs text-zinc-500">{summary}</span>}
        </div>
      ) : (
        <button
          type="button" onClick={() => setConfirming(true)}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
        >
          Mark sold
        </button>
      )}
    </div>
  );
}
