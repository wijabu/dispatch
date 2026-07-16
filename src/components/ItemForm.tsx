"use client";

import { useState } from "react";
import type { Item } from "@/db/schema";
import { CONDITIONS, VISIBLE_ITEM_STATUSES } from "@/db/schema";
import { CONDITION_LABELS, STATUS_LABELS } from "@/lib/format";
import { CATEGORY_SUGGESTIONS } from "@/config/categories";
import { OFFERUP_CATEGORIES, offerupSubcategories } from "@/config/offerup-categories";
import { PhotoDropzone } from "@/components/PhotoDropzone";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "block text-sm font-medium mb-1";

export function ItemForm({
  item,
  action,
}: {
  item?: Item;
  action: (formData: FormData) => Promise<void>;
}) {
  const [attributes, setAttributes] = useState<[string, string][]>(
    item ? Object.entries(item.attributes) : []
  );
  const [category, setCategory] = useState(item?.category ?? "general");
  const [offerupCategory, setOfferupCategory] = useState(
    item?.offerupCategory ?? ""
  );
  const [offerupSubcategory, setOfferupSubcategory] = useState(
    item?.offerupSubcategory ?? ""
  );

  function addAttribute(key = "") {
    // Functional update: rapid successive clicks (e.g. two chips) are batched
    // by React, so spreading the captured `attributes` would drop rows.
    setAttributes((prev) => [...prev, [key, ""]]);
  }

  return (
    <form action={action} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="name">
            Name *
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={item?.name ?? ""}
            placeholder="e.g. Rolex Explorer 124270"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="category">
            Category
          </label>
          <input
            id="category"
            name="category"
            list="category-suggestions"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          />
          <datalist id="category-suggestions">
            <option value="general" />
            <option value="watches" />
            <option value="electronics" />
            <option value="furniture" />
            <option value="clothing" />
            <option value="tools" />
          </datalist>
        </div>

        <div>
          <label className={labelClass} htmlFor="offerupCategory">
            OfferUp category
          </label>
          <select
            id="offerupCategory"
            name="offerupCategory"
            value={offerupCategory}
            onChange={(e) => {
              setOfferupCategory(e.target.value);
              setOfferupSubcategory("");
            }}
            className={inputClass}
          >
            <option value="">— none —</option>
            {OFFERUP_CATEGORIES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="offerupSubcategory">
            OfferUp subcategory
          </label>
          <select
            id="offerupSubcategory"
            name="offerupSubcategory"
            value={offerupSubcategory}
            onChange={(e) => setOfferupSubcategory(e.target.value)}
            className={inputClass}
          >
            <option value="">— none —</option>
            {offerupSubcategories(offerupCategory).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="condition">
            Condition
          </label>
          <select
            id="condition"
            name="condition"
            defaultValue={item?.condition ?? "good"}
            className={inputClass}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={5}
            defaultValue={item?.description ?? ""}
            placeholder="Condition details, history, what's included…"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="askingPrice">
            Asking price ($)
          </label>
          <input
            id="askingPrice"
            name="askingPrice"
            type="number"
            step="0.01"
            min="0"
            defaultValue={item?.askingPrice ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="minimumPrice">
            Minimum price ($)
          </label>
          <input
            id="minimumPrice"
            name="minimumPrice"
            type="number"
            step="0.01"
            min="0"
            defaultValue={item?.minimumPrice ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="purchasePrice">
            Purchase price ($, optional)
          </label>
          <input
            id="purchasePrice"
            name="purchasePrice"
            type="number"
            step="0.01"
            min="0"
            defaultValue={item?.purchasePrice ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="acquiredAt">
            Date acquired
          </label>
          <input
            id="acquiredAt"
            name="acquiredAt"
            type="date"
            defaultValue={item?.acquiredAt ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={item?.status ?? "draft"}
            className={inputClass}
          >
            {VISIBLE_ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <span className={labelClass}>
            Price drops
            <span className="ml-2 font-normal text-zinc-500">
              (optional — leave blank for no automatic drop suggestions)
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              name="dropAmount"
              type="number"
              step="1"
              min="0"
              placeholder="$"
              defaultValue={item?.dropAmount ?? ""}
              className={`${inputClass} w-24`}
            />
            <span className="text-zinc-500">or</span>
            <input
              name="dropPercent"
              type="number"
              step="0.5"
              min="0"
              max="99"
              placeholder="%"
              defaultValue={item?.dropPercent ?? ""}
              className={`${inputClass} w-24`}
            />
            <span className="text-zinc-500">every</span>
            <input
              name="dropIntervalDays"
              type="number"
              step="1"
              min="1"
              placeholder="7"
              defaultValue={item?.dropIntervalDays ?? ""}
              className={`${inputClass} w-20`}
            />
            <span className="text-zinc-500">days — never below your minimum price</span>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="notes">
            Notes (private)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={item?.notes ?? ""}
            placeholder="Never shown in listings — lowest offer received, buyer info, etc."
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">
            Attributes
            <span className="ml-2 font-normal text-zinc-500">
              (specs used in generated listings)
            </span>
          </span>
          <button
            type="button"
            onClick={() => addAttribute()}
            className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400"
          >
            + Add attribute
          </button>
        </div>
        {(CATEGORY_SUGGESTIONS[category] ?? []).filter(
          (s) => !attributes.some(([k]) => k === s)
        ).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {(CATEGORY_SUGGESTIONS[category] ?? [])
              .filter((s) => !attributes.some(([k]) => k === s))
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addAttribute(s)}
                  className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  + {s}
                </button>
              ))}
          </div>
        )}
        <div className="space-y-2">
          {attributes.map(([key, value], i) => (
            <div key={i} className="flex gap-2">
              <input
                name="attr_key"
                value={key}
                onChange={(e) => {
                  const next = [...attributes];
                  next[i] = [e.target.value, value];
                  setAttributes(next);
                }}
                placeholder="Name (e.g. Reference)"
                className={`${inputClass} max-w-[200px]`}
              />
              <input
                name="attr_value"
                value={value}
                onChange={(e) => {
                  const next = [...attributes];
                  next[i] = [key, e.target.value];
                  setAttributes(next);
                }}
                placeholder="Value (e.g. 124270)"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() =>
                  setAttributes(attributes.filter((_, j) => j !== i))
                }
                className="shrink-0 rounded-md border border-zinc-300 px-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700"
                aria-label="Remove attribute"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>
          {item ? "Add photos" : "Photos"}
        </label>
        <PhotoDropzone />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {item ? "Save changes" : "Create item"}
        </button>
      </div>
    </form>
  );
}
