import Link from "next/link";
import type { Task } from "@/lib/tasks";
import {
  applyPriceDrop,
  confirmListingPriceUpdated,
  confirmListingRenewed,
  endListingForRelist,
  snoozeItem,
} from "@/lib/actions";
import { formatPrice } from "@/lib/format";
import { OpenListingButton } from "@/components/OpenListingButton";

function SnoozeButton({ itemId }: { itemId: number }) {
  return (
    <form action={snoozeItem.bind(null, itemId)}>
      <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
        Snooze 7d
      </button>
    </form>
  );
}

function TaskRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      {children}
    </div>
  );
}

export function TaskSection({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 font-semibold">⚡ Today&apos;s Tasks ({tasks.length})</h2>
      <div className="space-y-2">
        {tasks.map((task, i) => {
          switch (task.type) {
            case "price_drop":
              return (
                <TaskRow key={i}>
                  <span className="text-sm">
                    💰 <strong>Drop price:</strong>{" "}
                    <Link href={`/items/${task.itemId}`} className="underline">
                      {task.itemName}
                    </Link>{" "}
                    — <s className="text-zinc-500">{formatPrice(task.currentPrice)}</s> →{" "}
                    <strong>{formatPrice(task.targetPrice)}</strong>
                  </span>
                  <span className="flex gap-1.5">
                    <form action={applyPriceDrop.bind(null, task.itemId)}>
                      <button className="rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700">
                        ✓ Apply {formatPrice(task.targetPrice)}
                      </button>
                    </form>
                    <SnoozeButton itemId={task.itemId} />
                  </span>
                </TaskRow>
              );
            case "stale_price":
              return (
                <TaskRow key={i}>
                  <span className="text-sm">
                    ⚠️ <strong>Stale price on {task.publisherName}:</strong>{" "}
                    <Link href={`/items/${task.itemId}`} className="underline">
                      {task.itemName}
                    </Link>{" "}
                    listed at {formatPrice(task.listedPrice)}, asking is now{" "}
                    <strong>{formatPrice(task.askingPrice)}</strong>
                  </span>
                  <span className="flex gap-1.5">
                    {task.publisherId === "facebook" && task.listingUrl && (
                      <OpenListingButton
                        url={task.listingUrl}
                        copyText={String(task.askingPrice)}
                      />
                    )}
                    <form action={confirmListingPriceUpdated.bind(null, task.listingId, task.itemId)}>
                      <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                        ✓ I updated it
                      </button>
                    </form>
                  </span>
                </TaskRow>
              );
            case "relist":
              return (
                <TaskRow key={i}>
                  <span className="text-sm">
                    🔄 <strong>{task.action === "renew" ? "Renew" : "Relist"} on {task.publisherName}:</strong>{" "}
                    <Link href={`/items/${task.itemId}`} className="underline">
                      {task.itemName}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      ({task.ageDays} days since {task.action === "renew" ? "last renew" : "listed"})
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    {task.publisherId === "facebook" && task.listingUrl && (
                      <OpenListingButton url={task.listingUrl} />
                    )}
                    {task.action === "renew" ? (
                      <form action={confirmListingRenewed.bind(null, task.listingId, task.itemId)}>
                        <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                          ✓ I renewed it
                        </button>
                      </form>
                    ) : (
                      <form action={endListingForRelist.bind(null, task.listingId, task.itemId)}>
                        <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                          End old + open Publish
                        </button>
                      </form>
                    )}
                    <SnoozeButton itemId={task.itemId} />
                  </span>
                </TaskRow>
              );
            case "ready_to_publish":
              return (
                <TaskRow key={i}>
                  <span className="text-sm">
                    📤 <strong>Ready to publish:</strong>{" "}
                    <Link href={`/items/${task.itemId}`} className="underline">
                      {task.itemName}
                    </Link>{" "}
                    <span className="text-zinc-500">(listed nowhere)</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Link
                      href={`/items/${task.itemId}/publish`}
                      className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      Open Publish tab
                    </Link>
                    <SnoozeButton itemId={task.itemId} />
                  </span>
                </TaskRow>
              );
          }
        })}
      </div>
    </section>
  );
}
