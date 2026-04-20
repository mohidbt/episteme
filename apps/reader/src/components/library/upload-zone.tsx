"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadZone() {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function uploadFile(file: File) {
    if (file.type !== "application/pdf") {
      alert("Only PDF files are supported.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Upload failed. Please try again.");
        return;
      }

      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // Reset so the same file can be re-uploaded if needed
    e.target.value = "";
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={uploading}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !uploading) {
          inputRef.current?.click();
        }
      }}
      className={[
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer select-none",
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/60 hover:bg-muted/40",
        uploading ? "opacity-50 cursor-not-allowed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={handleChange}
        disabled={uploading}
      />
      {uploading ? (
        <p className="text-sm text-muted-foreground">Uploading…</p>
      ) : (
        <>
          <p className="text-sm font-medium">
            Drag &amp; drop a PDF here, or click to select
          </p>
          <p className="text-xs text-muted-foreground">PDF files only</p>
        </>
      )}
    </div>
  );
}
