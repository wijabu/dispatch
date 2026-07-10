import Link from "next/link";
import { getItems, getFirstPhotos, getActiveListingsByItem } from "@/lib/queries";
import { formatPrice, STATUS_LABELS } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { ITEM_STATUSES, type ItemStatus } from "@/db/schema";
import { getPublisher } from "@/publishers";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  let allItems = await getItems(q);

  const counts = new Map<string, number>();
  for (const item of allItems) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }

  if (status && ITEM_STATUSES.includes(status as ItemStatus)) {
    allItems = allItems.filter((item) => item.status === status);
  }
  const thumbnails = await getFirstPhotos(allItems.map((i) => i.id));
  const listedWhere = await getActiveListingsByItem();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <form className="flex gap-2" action="/">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search items…"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Search
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/"
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !status
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          All
        </Link>
        {ITEM_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              status === s
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {STATUS_LABELS[s]}
            {counts.get(s) ? ` (${counts.get(s)})` : ""}
          </Link>
        ))}
      </div>

      {allItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-500">
            {q || status
              ? "No items match your filters."
              : "No items yet. Add your first item to get started."}
          </p>
          <Link
            href="/items/new"
            className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            + New Item
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allItems.map((item) => (
            <Link
              key={item.id}
              href={`/items/${item.id}`}
              className="group overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="aspect-[4/3] bg-zinc-100 dark:bg-zinc-800">
                {thumbnails.has(item.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/photos/${thumbnails.get(item.id)}`}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl text-zinc-300 dark:text-zinc-600">
                    📷
                  </div>
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium leading-tight group-hover:underline">
                    {item.name}
                  </h2>
                  <span className="shrink-0 font-semibold">
                    {formatPrice(
                      item.status === "sold" ? item.soldPrice : item.askingPrice
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-zinc-500">{item.category}</span>
                </div>
                {(listedWhere.get(item.id) ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(listedWhere.get(item.id) ?? []).map((pubId) => (
                      <span
                        key={pubId}
                        className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:text-green-400"
                      >
                        {getPublisher(pubId)?.name ?? pubId}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
