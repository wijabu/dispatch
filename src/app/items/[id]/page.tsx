import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem } from "@/lib/queries";
import { deleteItem, markSold, updateStatus } from "@/lib/actions";
import { formatDate, formatPrice, CONDITION_LABELS, STATUS_LABELS } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { PhotoGrid } from "@/components/PhotoGrid";
import { ITEM_STATUSES } from "@/db/schema";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(Number(id));
  if (!item) notFound();

  async function statusAction(formData: FormData) {
    "use server";
    const status = formData.get("status");
    const target = ITEM_STATUSES.find((s) => s === status);
    if (target && item) await updateStatus(item.id, target);
  }

  async function soldAction(formData: FormData) {
    "use server";
    const raw = String(formData.get("soldPrice") ?? "").trim();
    const price = raw === "" ? null : Number(raw);
    if (item)
      await markSold(item.id, Number.isFinite(price ?? NaN) ? price : null);
  }

  async function deleteAction() {
    "use server";
    if (item) await deleteItem(item.id);
  }

  const profit =
    item.soldPrice != null && item.purchasePrice != null
      ? item.soldPrice - item.purchasePrice
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{item.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="text-sm text-zinc-500">
              {item.category} · {CONDITION_LABELS[item.condition]}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/items/${item.id}/publish`}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Publish
          </Link>
          <Link
            href={`/items/${item.id}/edit`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Edit
          </Link>
          <form action={deleteAction}>
            <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">
              Delete
            </button>
          </form>
        </div>
      </div>

      <PhotoGrid photos={item.photos} itemId={item.id} />

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <div className="text-xs text-zinc-500">Asking</div>
          <div className="text-lg font-semibold">
            {formatPrice(item.askingPrice)}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Minimum</div>
          <div className="text-lg font-semibold">
            {formatPrice(item.minimumPrice)}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Paid</div>
          <div className="text-lg font-semibold">
            {formatPrice(item.purchasePrice)}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">
            {item.status === "sold" ? "Sold for" : "Potential profit"}
          </div>
          <div className="text-lg font-semibold">
            {item.status === "sold"
              ? formatPrice(item.soldPrice)
              : item.askingPrice != null && item.purchasePrice != null
                ? formatPrice(item.askingPrice - item.purchasePrice)
                : "—"}
          </div>
          {profit != null && (
            <div
              className={`text-xs ${profit >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {profit >= 0 ? "+" : ""}
              {formatPrice(profit)} profit
            </div>
          )}
        </div>
      </div>

      {item.description && (
        <section>
          <h2 className="mb-1 text-sm font-medium text-zinc-500">
            Description
          </h2>
          <p className="whitespace-pre-wrap text-sm">{item.description}</p>
        </section>
      )}

      {Object.keys(item.attributes).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-500">
            Attributes
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {Object.entries(item.attributes).map(([key, value]) => (
              <div key={key} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-800">
                <dt className="text-zinc-500">{key}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {item.notes && (
        <section className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
          <h2 className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">
            Private notes
          </h2>
          <p className="whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">
            {item.notes}
          </p>
        </section>
      )}

      <section className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <form action={statusAction} className="flex items-end gap-2">
          <div>
            <label
              htmlFor="status"
              className="mb-1 block text-xs text-zinc-500"
            >
              Change status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={item.status}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Update
          </button>
        </form>

        {item.status !== "sold" && (
          <form action={soldAction} className="flex items-end gap-2">
            <div>
              <label
                htmlFor="soldPrice"
                className="mb-1 block text-xs text-zinc-500"
              >
                Sold price ($)
              </label>
              <input
                id="soldPrice"
                name="soldPrice"
                type="number"
                step="0.01"
                min="0"
                placeholder={item.askingPrice?.toString() ?? ""}
                className="w-32 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <button className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700">
              Mark sold
            </button>
          </form>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-zinc-500">Acquired</div>
          <div>{formatDate(item.acquiredAt)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Created</div>
          <div>{formatDate(item.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Updated</div>
          <div>{formatDate(item.updatedAt)}</div>
        </div>
        {item.soldAt && (
          <div>
            <div className="text-xs text-zinc-500">Sold</div>
            <div>{formatDate(item.soldAt)}</div>
          </div>
        )}
      </section>

      {item.prices.length > 1 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-500">
            Price history
          </h2>
          <ul className="space-y-1 text-sm">
            {item.prices.map((price) => (
              <li key={price.id} className="flex gap-4">
                <span className="text-zinc-500">
                  {formatDate(price.changedAt)}
                </span>
                <span className="font-medium">
                  {formatPrice(price.askingPrice)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
