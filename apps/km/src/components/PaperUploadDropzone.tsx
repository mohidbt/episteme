"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PDF_CONTENT_TYPE = "application/pdf";
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PARALLEL = 3;

type UploadStatus = "queued" | "uploading" | "finalizing" | "done" | "failed";

interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  paperId?: string;
  error?: string;
}

interface PaperUploadDropzoneProps {
  libraryId: number;
  folderPath: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", PDF_CONTENT_TYPE);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_failed_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.send(file);
  });
}

async function runChunks<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export function PaperUploadDropzone({
  libraryId,
  folderPath,
}: PaperUploadDropzoneProps) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const counterRef = useRef(0);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const processFile = useCallback(
    async (item: UploadItem) => {
      try {
        updateItem(item.id, { status: "uploading" });
        const initRes = await fetch("/api/papers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            libraryId,
            folderPath,
            filename: item.file.name,
            contentType: PDF_CONTENT_TYPE,
            sizeBytes: item.file.size,
          }),
        });
        if (!initRes.ok) {
          throw new Error(`init_failed_${initRes.status}`);
        }
        const { paperId, uploadUrl } = (await initRes.json()) as {
          paperId: string;
          uploadUrl: string;
        };
        updateItem(item.id, { paperId });

        await putWithProgress(uploadUrl, item.file, (pct) =>
          updateItem(item.id, { progress: pct }),
        );

        updateItem(item.id, { status: "finalizing", progress: 100 });
        const finRes = await fetch(`/api/papers/${paperId}/finalize`, {
          method: "POST",
        });
        if (!finRes.ok) {
          throw new Error(`finalize_failed_${finRes.status}`);
        }

        updateItem(item.id, { status: "done" });
        toast.success(`Uploaded ${item.file.name}`, {
          action: {
            label: "Open",
            onClick: () => router.push(`/p/${paperId}`),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload_failed";
        updateItem(item.id, { status: "failed", error: msg });
        toast.error(`Failed: ${item.file.name}`, { description: msg });
      }
    },
    [libraryId, folderPath, router, updateItem],
  );

  const onDrop = useCallback(
    async (accepted: File[], rejected: readonly unknown[]) => {
      if (rejected.length > 0) {
        toast.error(`${rejected.length} file(s) rejected (PDF only)`);
      }
      const ok: File[] = [];
      for (const f of accepted) {
        if (f.size > MAX_PDF_BYTES) {
          toast.error(`${f.name} exceeds 50 MB`);
          continue;
        }
        ok.push(f);
      }
      if (ok.length === 0) return;

      const next: UploadItem[] = ok.map((file) => ({
        id: `${Date.now()}-${counterRef.current++}`,
        file,
        status: "queued",
        progress: 0,
      }));
      setItems((prev) => [...prev, ...next]);

      await runChunks(next, PARALLEL, processFile);
      router.refresh();
    },
    [processFile, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { [PDF_CONTENT_TYPE]: [".pdf"] },
    multiple: true,
    noClick: false,
  });

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== "done" && it.status !== "failed"));
  }, []);

  const hasFinished = items.some(
    (it) => it.status === "done" || it.status === "failed",
  );

  return (
    <div className="mb-6">
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center transition-colors hover:border-border hover:bg-muted/40",
          isDragActive && "border-border bg-muted/60",
        )}
      >
        <input {...getInputProps()} />
        <p className="font-display text-sm">
          {isDragActive ? "Drop PDFs here" : "Drop PDFs or click to upload"}
        </p>
        <p className="mt-1 text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
          PDF only · up to 50 MB · {folderPath || "library root"}
        </p>
      </div>

      {items.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {items.map((it) => (
            <UploadRow
              key={it.id}
              item={it}
              onOpen={() =>
                it.paperId && it.status === "done" && router.push(`/p/${it.paperId}`)
              }
            />
          ))}
          {hasFinished && (
            <button
              type="button"
              onClick={clearFinished}
              className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground"
            >
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function statusLabel(status: UploadStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "finalizing":
      return "Finalizing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
  }
}

function UploadRow({ item, onOpen }: { item: UploadItem; onOpen: () => void }) {
  const clickable = item.status === "done";
  return (
    <div
      onClick={clickable ? onOpen : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md border border-border/60 px-3 py-2",
        clickable && "cursor-pointer hover:border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm">{item.file.name}</p>
          <span className="shrink-0 text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
            {statusLabel(item.status)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className={cn(
                "h-full transition-all",
                item.status === "failed" ? "bg-destructive" : "bg-foreground/70",
              )}
              style={{ width: `${item.progress}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {humanSize(item.file.size)}
          </span>
        </div>
        {item.status === "failed" && item.error && (
          <p className="mt-1 text-xs text-destructive">{item.error}</p>
        )}
      </div>
    </div>
  );
}
