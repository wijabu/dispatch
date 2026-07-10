import type { Photo } from "@/db/schema";
import { deletePhoto, makePrimaryPhoto } from "@/lib/actions";

export function PhotoGrid({
  photos,
  itemId,
  editable = false,
}: {
  photos: Photo[];
  itemId: number;
  editable?: boolean;
}) {
  if (photos.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo, index) => (
        <div key={photo.id} className="group relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/photos/${photo.path}`}
            alt=""
            className="aspect-square w-full rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
          />
          {index === 0 && (
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
              ★ Primary
            </span>
          )}
          {editable && (
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {index > 0 && (
                <form action={makePrimaryPhoto.bind(null, photo.id, itemId)}>
                  <button
                    className="rounded-full bg-black/70 px-2 py-0.5 text-xs text-white hover:bg-amber-500"
                    aria-label="Make primary photo"
                    title="Make primary — shown first in listings and searches"
                  >
                    ★
                  </button>
                </form>
              )}
              <form action={deletePhoto.bind(null, photo.id, itemId)}>
                <button
                  className="rounded-full bg-black/70 px-2 py-0.5 text-xs text-white hover:bg-red-600"
                  aria-label="Delete photo"
                >
                  ✕
                </button>
              </form>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
