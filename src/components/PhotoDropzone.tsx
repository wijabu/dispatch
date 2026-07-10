"use client";

import { useRef, useState } from "react";

export function PhotoDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);

  function acceptFiles(files: FileList) {
    if (!inputRef.current) return;
    inputRef.current.files = files;
    setFileNames(Array.from(files).map((f) => f.name));
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) acceptFiles(e.dataTransfer.files);
      }}
      className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
        dragOver
          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800"
          : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        name="photos"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) setFileNames(Array.from(e.target.files).map((f) => f.name));
        }}
      />
      {fileNames.length > 0 ? (
        <span>
          {fileNames.length} photo{fileNames.length === 1 ? "" : "s"} selected:{" "}
          {fileNames.join(", ")}
        </span>
      ) : (
        <span>Drag photos here (AirDrop them to this Mac first) — or click to browse</span>
      )}
    </div>
  );
}
