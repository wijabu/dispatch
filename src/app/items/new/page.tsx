import { createItem } from "@/lib/actions";
import { ItemForm } from "@/components/ItemForm";

export default function NewItemPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">New Item</h1>
      <ItemForm action={createItem} />
    </div>
  );
}
