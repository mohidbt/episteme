"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type FolderRow,
  breadcrumbFromChain,
  resolveChain,
} from "@/lib/folders";
import { MoveToDialog } from "./MoveToDialog";

export function ImportControls({
  libraryId,
  folders = [],
}: {
  libraryId: number;
  folders?: FolderRow[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const router = useRouter();

  function folderLabel(): string {
    if (!targetFolderId) return "Library root";
    const chain = resolveChain(folders, targetFolderId);
    const crumb = breadcrumbFromChain(chain);
    return crumb || "Library root";
  }

  async function upload() {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (targetFolderId) {
        fd.append("folderId", targetFolderId);
      }
      const res = await fetch(`/api/libraries/${libraryId}/import`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Import failed");
        return;
      }
      toast.success(
        `Imported ${json.imported} item${json.imported === 1 ? "" : "s"}${
          json.skipped > 0 ? `, skipped ${json.skipped}` : ""
        }`,
      );
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      toast.error("Import failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.md"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background hover:bg-accent px-3 py-1.5 text-sm font-medium transition-colors"
        >
          Choose file…
        </button>
        {file && (
          <span className="text-xs text-muted-foreground truncate max-w-[12ch]">
            {file.name}
          </span>
        )}
        <button
          type="button"
          onClick={upload}
          disabled={!file || uploading}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background hover:bg-accent px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          aria-label={`Import into: ${folderLabel()} (change…)`}
          onClick={() => setPickerOpen(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Import into: <span className="font-medium">{folderLabel()}</span>{" "}
          (change…)
        </button>
      </div>
      <MoveToDialog
        libraryId={libraryId}
        folders={folders}
        currentFolderId={null}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onMove={async (id) => {
          setTargetFolderId(id);
        }}
        title="Import into folder"
        description="Pick a destination folder for imported items."
      />
    </div>
  );
}
