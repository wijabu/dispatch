"use server";

import { db, PHOTOS_DIR } from "@/db";
import {
  items,
  listings,
  photos,
  priceHistory,
  type Condition,
  type ItemStatus,
  CONDITIONS,
  ITEM_STATUSES,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { convertHeicToJpeg, isHeic } from "@/lib/photo-convert";
import { setPhotoOrder, setPrimaryPhoto } from "@/lib/photo-order";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";

function parsePrice(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseAttributes(formData: FormData): Record<string, string> {
  const attrs: Record<string, string> = {};
  const keys = formData.getAll("attr_key");
  const values = formData.getAll("attr_value");
  keys.forEach((key, i) => {
    const k = String(key).trim();
    const v = String(values[i] ?? "").trim();
    if (k && v) attrs[k] = v;
  });
  return attrs;
}

function itemFieldsFromForm(formData: FormData) {
  const condition = String(formData.get("condition") ?? "good");
  const status = String(formData.get("status") ?? "draft");
  return {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? "general").trim() || "general",
    condition: (CONDITIONS.includes(condition as Condition)
      ? condition
      : "good") as Condition,
    status: (ITEM_STATUSES.includes(status as ItemStatus)
      ? status
      : "draft") as ItemStatus,
    purchasePrice: parsePrice(formData.get("purchasePrice")),
    askingPrice: parsePrice(formData.get("askingPrice")),
    minimumPrice: parsePrice(formData.get("minimumPrice")),
    notes: String(formData.get("notes") ?? ""),
    attributes: parseAttributes(formData),
    acquiredAt: String(formData.get("acquiredAt") ?? "") || null,
  };
}

async function savePhotos(itemId: number, formData: FormData) {
  const files = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const existing = await db
    .select({ max: sql<number>`coalesce(max(sort_order), -1)` })
    .from(photos)
    .where(eq(photos.itemId, itemId));
  let order = (existing[0]?.max ?? -1) + 1;

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase() || ".jpg";
    let filename = `${itemId}-${crypto.randomUUID()}${ext}`;
    await fs.writeFile(
      path.join(PHOTOS_DIR, filename),
      Buffer.from(await file.arrayBuffer())
    );
    if (isHeic(filename)) {
      const jpegPath = await convertHeicToJpeg(path.join(PHOTOS_DIR, filename));
      filename = path.basename(jpegPath);
    }
    await db.insert(photos).values({
      itemId,
      path: filename,
      sortOrder: order++,
    });
  }
}

export async function createItem(formData: FormData) {
  const fields = itemFieldsFromForm(formData);
  if (!fields.name) throw new Error("Name is required");

  const [item] = await db.insert(items).values(fields).returning();

  if (fields.askingPrice != null) {
    await db.insert(priceHistory).values({
      itemId: item.id,
      askingPrice: fields.askingPrice,
    });
  }

  await savePhotos(item.id, formData);
  revalidatePath("/");
  redirect(`/items/${item.id}`);
}

export async function updateItem(itemId: number, formData: FormData) {
  const fields = itemFieldsFromForm(formData);
  if (!fields.name) throw new Error("Name is required");

  const [before] = await db
    .select()
    .from(items)
    .where(eq(items.id, itemId));
  if (!before) throw new Error("Item not found");

  await db
    .update(items)
    .set({ ...fields, updatedAt: sql`(datetime('now'))` })
    .where(eq(items.id, itemId));

  if (
    fields.askingPrice != null &&
    fields.askingPrice !== before.askingPrice
  ) {
    await db.insert(priceHistory).values({
      itemId,
      askingPrice: fields.askingPrice,
    });
  }

  await savePhotos(itemId, formData);
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  redirect(`/items/${itemId}`);
}

export async function updateStatus(itemId: number, status: ItemStatus) {
  await db
    .update(items)
    .set({
      status,
      updatedAt: sql`(datetime('now'))`,
      ...(status === "sold" ? { soldAt: sql`(datetime('now'))` } : {}),
    })
    .where(eq(items.id, itemId));
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
}

export async function markSold(itemId: number, soldPrice: number | null) {
  await db
    .update(items)
    .set({
      status: "sold",
      soldPrice,
      soldAt: sql`(datetime('now'))`,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(items.id, itemId));
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
}

export async function deleteItem(itemId: number) {
  const itemPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.itemId, itemId));
  for (const photo of itemPhotos) {
    await fs.unlink(path.join(PHOTOS_DIR, photo.path)).catch(() => {});
  }
  await db.delete(items).where(eq(items.id, itemId));
  revalidatePath("/");
  redirect("/");
}

export async function deletePhoto(photoId: number, itemId: number) {
  const [photo] = await db
    .select()
    .from(photos)
    .where(eq(photos.id, photoId));
  if (photo) {
    await fs.unlink(path.join(PHOTOS_DIR, photo.path)).catch(() => {});
    await db.delete(photos).where(eq(photos.id, photoId));
  }
  revalidatePath(`/items/${itemId}`);
}

export async function makePrimaryPhoto(photoId: number, itemId: number) {
  await setPrimaryPhoto(db, photoId, itemId);
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/edit`);
}

export async function reorderPhotos(itemId: number, orderedIds: number[]) {
  await setPhotoOrder(db, itemId, orderedIds);
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/edit`);
}

export async function markListed(formData: FormData) {
  const itemId = Number(formData.get("itemId"));
  const publisherId = String(formData.get("publisherId") ?? "");
  if (!itemId || !publisherId) throw new Error("itemId and publisherId are required");

  const listedPrice = parsePrice(formData.get("listedPrice"));
  const url = String(formData.get("url") ?? "").trim() || null;

  db.transaction((tx) => {
    const [existing] = tx
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.itemId, itemId),
          eq(listings.publisher, publisherId),
          eq(listings.status, "active")
        )
      )
      .all();
    if (existing) return;

    tx.insert(listings)
      .values({
        itemId,
        publisher: publisherId,
        listedPrice,
        url,
      })
      .run();

    const [item] = tx.select().from(items).where(eq(items.id, itemId)).all();
    if (item && item.status !== "sold") {
      tx.update(items)
        .set({ status: "published", updatedAt: sql`(datetime('now'))` })
        .where(eq(items.id, itemId))
        .run();
    }
  });

  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/publish`);
}

export async function markListingEnded(formData: FormData) {
  const listingId = Number(formData.get("listingId"));
  const itemId = Number(formData.get("itemId"));
  if (!listingId) throw new Error("listingId is required");

  await db
    .update(listings)
    .set({ status: "ended", endedAt: sql`(datetime('now'))` })
    .where(eq(listings.id, listingId));

  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/publish`);
}
