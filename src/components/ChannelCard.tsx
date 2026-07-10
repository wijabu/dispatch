"use client";

import { useState } from "react";
import type { GeneratedListing } from "@/publishers/types";
import type { Listing } from "@/db/schema";
import { markListed, markListingEnded } from "@/lib/actions";
import { formatDate, formatPrice } from "@/lib/format";

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

export function ChannelCard({
  publisherId,
  publisherName,
  generated,
  listing,
  itemId,
  defaultPrice,
}: {
  publisherId: string;
  publisherName: string;
  generated: GeneratedListing;
  listing: Listing | null;
  itemId: number;
  defaultPrice: number | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{publisherName}</span>
          {listing && (
            <span className="ml-2 text-xs text-purple-600 dark:text-purple-400">
              listed at {formatPrice(listing.listedPrice)} on {formatDate(listing.listedAt)}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <CopyButton label="Copy title" text={generated.title} />
          <CopyButton label="Copy body" text={generated.body} />
        </div>
      </div>

      <div className="mt-3 rounded-md bg-zinc-50 p-2.5 font-mono text-xs dark:bg-zinc-800">
        <div className="font-semibold">{generated.title}</div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-zinc-500 underline"
        >
          {expanded ? "Hide body" : "Show body"}
        </button>
        {expanded && <pre className="mt-2 whitespace-pre-wrap">{generated.body}</pre>}
      </div>

      {generated.structuredFields && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          {Object.entries(generated.structuredFields).map(([key, value]) => (
            <span key={key}>
              {key}: <span className="font-medium text-zinc-700 dark:text-zinc-300">{value || "—"}</span>
            </span>
          ))}
        </div>
      )}

      {generated.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-600 dark:text-amber-400">
          {generated.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {listing ? (
          <form action={markListingEnded} className="flex items-center gap-2">
            <input type="hidden" name="listingId" value={listing.id} />
            <input type="hidden" name="itemId" value={itemId} />
            {listing.url && (
              <a
                href={listing.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 underline dark:text-blue-400"
              >
                View listing ↗
              </a>
            )}
            <button className="ml-auto rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">
              Mark ended
            </button>
          </form>
        ) : (
          <form action={markListed} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="publisherId" value={publisherId} />
            <div>
              <label className="mb-0.5 block text-xs text-zinc-500">Listed price ($)</label>
              <input
                name="listedPrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={defaultPrice ?? ""}
                className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div className="flex-1 min-w-40">
              <label className="mb-0.5 block text-xs text-zinc-500">URL (optional)</label>
              <input
                name="url"
                type="url"
                placeholder="https://…"
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <button className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700">
              ✓ Mark listed
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
