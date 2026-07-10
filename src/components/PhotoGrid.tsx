"use client";

import { useEffect, useRef, useState } from "react";
import type { Photo } from "@/db/schema";
import { deletePhoto, makePrimaryPhoto, reorderPhotos } from "@/lib/actions";

export function PhotoGrid({
  photos,
  itemId,
  editable = false,
}: {
  photos: Photo[];
  itemId: number;
  editable?: boolean;
}) {
  // Optimistic order: drag updates immediately, server revalidation re-syncs.
  const [ordered, setOrdered] = useState(photos);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => setOrdered(photos), [photos]);

  function handleDrop(targetIndex: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOverIndex(null);
    if (from == null || from === targetIndex) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    setOrdered(next);
    void reorderPhotos(
      itemId,
      next.map((p) => p.id)
    );
  }

  if (ordered.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {ordered.map((photo, index) => (
        <div
          key={photo.id}
          className={`group relative ${editable ? "cursor-grab" : ""} ${
            dragOverIndex === index ? "ring-2 ring-amber-500 rounded-md" : ""
          }`}
          draggable={editable}
          onDragStart={() => {
            dragIndex.current = index;
          }}
          onDragOver={(e) => {
            if (!editable) return;
            e.preventDefault();
            setDragOverIndex(index);
          }}
          onDragLeave={() => setDragOverIndex(null)}
          onDrop={(e) => {
            if (!editable) return;
            e.preventDefault();
            handleDrop(index);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/photos/${photo.path}`}
            alt=""
            className="pointer-events-none aspect-square w-full rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
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
