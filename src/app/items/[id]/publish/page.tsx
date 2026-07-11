import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem } from "@/lib/queries";
import { publishers } from "@/publishers";
import { ChannelCard } from "@/components/ChannelCard";
import { StatusBadge } from "@/components/StatusBadge";
import { describeRelistPolicy } from "@/lib/format";
import { AUTOFILL_CHANNELS, buildStagedBundle } from "@/config/staging";

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(Number(id));
  if (!item) notFound();
  const { photos, listings, prices: _prices, ...itemRow } = item;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Publish: {item.name}</h1>
          <div className="mt-1">
            <StatusBadge status={item.status} />
          </div>
        </div>
        <Link
          href={`/items/${item.id}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ← Back to item
        </Link>
      </div>

      <div className="space-y-4">
        {publishers.map((pub) => {
          const generated = pub.generate(itemRow, photos);
          const activeListing =
            listings.find((l) => l.publisher === pub.id && l.status === "active") ?? null;
          return (
            <ChannelCard
              key={pub.id}
              publisherId={pub.id}
              publisherName={pub.name}
              generated={generated}
              listing={activeListing}
              itemId={item.id}
              defaultPrice={item.askingPrice}
              policyLabel={describeRelistPolicy(pub.relistPolicy)}
              autoFill={AUTOFILL_CHANNELS[pub.id] ?? false}
              stageTier={
                pub.id === "facebook"
                  ? "facebook"
                  : pub.id === "reddit-watchexchange"
                    ? "reddit"
                    : pub.id === "watchuseek"
                      ? "watchuseek"
                      : null
              }
              stagedBundle={buildStagedBundle(generated)}
              note={
                pub.id === "offerup"
                  ? "OfferUp disabled web posting — it's app-only now. Copy the text above and post from the OfferUp app."
                  : null
              }
            />
          );
        })}
      </div>
    </div>
  );
}
