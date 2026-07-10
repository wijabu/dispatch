import type { Photo } from "@/db/schema";
import { deletePhoto } from "@/lib/actions";

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
      {photos.map((photo) => (
        <div key={photo.id} className="group relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/photos/${photo.path}`}
            alt=""
            className="aspect-square w-full rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
          />
          {editable && (
            <form
              action={deletePhoto.bind(null, photo.id, itemId)}
              className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <button
                className="rounded-full bg-black/70 px-2 py-0.5 text-xs text-white hover:bg-red-600"
                aria-label="Delete photo"
              >
                ✕
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
