import { notFound } from "next/navigation";
import { getItem } from "@/lib/queries";
import { updateItem } from "@/lib/actions";
import { ItemForm } from "@/components/ItemForm";
import { PhotoGrid } from "@/components/PhotoGrid";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(Number(id));
  if (!item) notFound();

  const updateWithId = updateItem.bind(null, item.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Edit: {item.name}</h1>
      {item.photos.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Current photos</h2>
          <PhotoGrid photos={item.photos} itemId={item.id} editable />
        </div>
      )}
      <ItemForm item={item} action={updateWithId} />
    </div>
  );
}
