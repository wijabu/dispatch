"use client";

import { openListingInDedicatedBrowser } from "@/lib/automation-actions";

export function OpenListingButton({
  url,
  copyText,
}: {
  url: string;
  copyText?: string;
}) {
  return (
    <button
      type="button"
      onClick={async () => {
        if (copyText) await navigator.clipboard.writeText(copyText).catch(() => {});
        await openListingInDedicatedBrowser(url);
      }}
      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Open listing ↗
    </button>
  );
}
