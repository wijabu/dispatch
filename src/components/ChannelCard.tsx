"use client";

import { useState, useTransition } from "react";
import type { GeneratedListing } from "@/publishers/types";
import type { Listing } from "@/db/schema";
import { markListed, markListingEnded } from "@/lib/actions";
import { formatDate, formatPrice } from "@/lib/format";
import {
  openAndPrefill,
  openForLogin,
  postToOfferup,
  dropOfferupPrice,
  stageForFacebook,
} from "@/lib/automation-actions";
import type { FillResult } from "@/automation/types";
import type { AndroidResult } from "@/automation/android";
import { STAGING } from "@/config/staging";

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
  policyLabel,
  autoFill,
  stageTier,
  stagedBundle,
  note,
  offerupAutomation,
}: {
  publisherId: string;
  publisherName: string;
  generated: GeneratedListing;
  listing: Listing | null;
  itemId: number;
  defaultPrice: number | null;
  policyLabel: string;
  autoFill: boolean; // Tier 1 available for this channel
  stageTier: "facebook" | "reddit" | "watchuseek" | null;
  stagedBundle: string; // paste-ready text for staged handoff
  note?: string | null; // channel-specific hint
  offerupAutomation?: boolean; // OfferUp Android automation (post/reprice) available
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [stageNote, setStageNote] = useState<string | null>(null);
  const [androidResult, setAndroidResult] = useState<AndroidResult | null>(null);

  function fillStatusLine(r: FillResult): string {
    switch (r.status) {
      case "ready":
        return "✅ Ready — review the window and submit, then Mark listed.";
      case "login_required":
        return "🔐 Log in in the open window, then hit Pre-fill again.";
      case "partial":
        return `⚠️ Filled ${r.filled.join(", ")}; ${r.failedAt} failed — finish that part by hand.`;
      case "failed":
        return `❌ Auto-fill failed (${r.reason}) — window is open; use the copy buttons.`;
    }
  }

  function offerupStatusLine(r: AndroidResult, mode: "post" | "sync"): string {
    switch (r.status) {
      case "posted_review":
        return "Filled — review in the emulator, tap Post, then Mark listed.";
      case "done":
        return mode === "post" ? "Posted ✓" : "Price synced ✓";
      case "login_required":
        return "Log into OfferUp in the emulator, then retry.";
      case "failed":
        return `Failed at ${r.step} (${r.reason}) — screenshot saved.`;
    }
  }

  // Staged-handoff runner: serialize with the auto-fill buttons via isPending
  // (guards the Facebook photo-staging race on double-click) and surface a
  // failure note instead of an unhandled rejection. Copies the bundle first
  // and reports honestly whether the clipboard write actually succeeded.
  function runStage(after: (copied: boolean, note: (s: string) => void) => Promise<void>) {
    startTransition(async () => {
      setFillResult(null);
      try {
        const copied = await navigator.clipboard
          .writeText(stagedBundle)
          .then(() => true)
          .catch(() => false);
        await after(copied, setStageNote);
      } catch (e) {
        setStageNote(`❌ Staging failed: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div>
            <span className="font-semibold">{publisherName}</span>
            <div className="text-[11px] text-zinc-500">{policyLabel}</div>
          </div>
          {listing && (
            <span className="ml-2 text-xs text-purple-600 dark:text-purple-400">
              listed at {formatPrice(listing.listedPrice)} on {formatDate(listing.listedAt)}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <CopyButton label="Copy title" text={generated.title} />
          <CopyButton label="Copy body" text={generated.body} />
          {autoFill && (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setFillResult(null);
                    const r = await openForLogin(publisherId);
                    setStageNote(
                      r.ok
                        ? "🔐 Log in in the Dispatch browser window, then click Open & pre-fill."
                        : `❌ Couldn't open the login page (${r.reason}).`
                    );
                  })
                }
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Log in
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setStageNote(null);
                    setFillResult(null);
                    setFillResult(await openAndPrefill(itemId, publisherId));
                  })
                }
                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? "Filling…" : "Open & pre-fill"}
              </button>
            </>
          )}
          {offerupAutomation && !listing && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setStageNote(null);
                  setAndroidResult(null);
                  setAndroidResult(await postToOfferup(itemId));
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Posting…" : "Post to OfferUp"}
            </button>
          )}
          {offerupAutomation && listing && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setStageNote(null);
                  setAndroidResult(null);
                  setAndroidResult(await dropOfferupPrice(itemId, listing.id));
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Syncing…" : "Sync price to OfferUp"}
            </button>
          )}
          {stageTier === "facebook" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                runStage(async (copied, note) => {
                  const { stagedPhotos } = await stageForFacebook(itemId);
                  const lead = copied ? "📋 Listing text copied." : "⚠️ Copy failed — use Copy body.";
                  note(
                    stagedPhotos === 0
                      ? `${lead} No photos to stage; Firefox is opening.`
                      : `${lead} Firefox is opening; drag the ${stagedPhotos} photo${stagedPhotos === 1 ? "" : "s"} from the Finder window.`
                  );
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Stage for Facebook
            </button>
          )}
          {stageTier === "reddit" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                runStage(async (copied, note) => {
                  window.open(STAGING.redditSubmitUrl, "_blank");
                  note(
                    `${copied ? "📋 Title + body copied." : "⚠️ Copy failed — use the copy buttons."} Paste into the submit page; host photos yourself for now.`
                  );
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Stage for Reddit
            </button>
          )}
          {stageTier === "watchuseek" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                runStage(async (copied, note) => {
                  window.open(STAGING.watchuseekCreateThreadUrl, "_blank");
                  note(
                    `${copied ? "📋 Title + body copied." : "⚠️ Copy failed — use the copy buttons."} Opening the new-thread page in your browser — log in if needed, paste, and add photos by hand.`
                  );
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Stage for Watchuseek
            </button>
          )}
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

      {note && (
        <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">ℹ️ {note}</div>
      )}
      {fillResult && (
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{fillStatusLine(fillResult)}</div>
      )}
      {androidResult && (
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {offerupStatusLine(androidResult, listing ? "sync" : "post")}
        </div>
      )}
      {stageNote && (
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{stageNote}</div>
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
