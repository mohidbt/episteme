"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { XIcon, RotateCcwIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const DONE_AUTO_DISMISS_MS = 1500;

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB, mirrors validators
const MAX_TEXT_BYTES = 5 * 1024 * 1024; // 5 MB

type FileType = "paper" | "note" | "reference" | "data" | "image" | "unknown";
type UploadStatus = "queued" | "uploading" | "done" | "failed" | "cancelled";

interface UploadItem {
  id: string;
  file: File;
  fileType: FileType;
  status: UploadStatus;
  progress: number;
  error?: string;
  // For abortable XHR uploads (paper/asset PUTs). Stored on the item so the
  // Cancel button can call .abort(). Set transiently while a PUT is in-flight.
  xhr?: XMLHttpRequest | null;
  // For abortable fetches (note/reference single-shot uploads).
  controller?: AbortController | null;
  // Server-side row id created during init, before the bytes upload starts.
  // On cancel we DELETE this row so we don't leave orphans.
  paperId?: string | null;
  assetId?: string | null;
}

interface UnifiedDropzoneProps {
  libraryId: number;
  folderPath: string;
  folderId?: string | null;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function detectFileType(file: File): FileType {
  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  if (ext === "pdf") return "paper";
  if (["md", "markdown", "txt"].includes(ext)) return "note";
  if (ext === "bib") return "reference";
  if (["csv", "json", "tsv"].includes(ext)) return "data";
  if (ext in IMAGE_MIME_BY_EXT) return "image";
  return "unknown";
}

function imageMimeFor(file: File): string | null {
  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PutHandle {
  promise: Promise<void>;
  xhr: XMLHttpRequest;
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): PutHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_failed_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.onabort = () => reject(new Error("cancelled"));
    xhr.send(file);
  });
  return { promise, xhr };
}

export function UnifiedDropzone({
  libraryId,
  folderPath,
  folderId,
}: UnifiedDropzoneProps) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const counterRef = useRef(0);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // Auto-dismiss successfully-completed uploads after a brief flash so the
  // user sees the ✓ then it goes away. Failed/cancelled stay until manually
  // cleared so the user can retry / read the error.
  useEffect(() => {
    const doneIds = items.filter((it) => it.status === "done").map((it) => it.id);
    if (doneIds.length === 0) return;
    const t = setTimeout(() => {
      setItems((prev) => prev.filter((it) => !doneIds.includes(it.id)));
    }, DONE_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [items]);

  const processFile = useCallback(
    async (item: UploadItem) => {
      updateItem(item.id, {
        status: "uploading",
        progress: 0,
        error: undefined,
        xhr: null,
        controller: null,
        paperId: null,
        assetId: null,
      });
      try {
        if (item.fileType === "paper") {
          const initRes = await fetch("/api/papers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              libraryId,
              folderPath,
              ...(folderId != null ? { folderId } : {}),
              filename: item.file.name,
              contentType: "application/pdf",
              sizeBytes: item.file.size,
            }),
          });
          if (!initRes.ok) throw new Error(`init_failed_${initRes.status}`);
          const { paperId, uploadUrl } = (await initRes.json()) as {
            paperId: string;
            uploadUrl: string;
          };
          updateItem(item.id, { paperId });

          const handle = putWithProgress(uploadUrl, item.file, "application/pdf", (pct) =>
            updateItem(item.id, { progress: pct }),
          );
          updateItem(item.id, { xhr: handle.xhr });
          await handle.promise;
          updateItem(item.id, { xhr: null });

          const finRes = await fetch(`/api/papers/${paperId}/finalize`, { method: "POST" });
          if (!finRes.ok) throw new Error(`finalize_failed_${finRes.status}`);
          updateItem(item.id, { status: "done", progress: 100 });
        } else if (item.fileType === "image") {
          const contentType = imageMimeFor(item.file);
          if (!contentType) throw new Error("unsupported_image");
          const initRes = await fetch("/api/assets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              libraryId,
              ...(folderId != null ? { folderId } : {}),
              filename: item.file.name,
              contentType,
              sizeBytes: item.file.size,
            }),
          });
          if (!initRes.ok) throw new Error(`init_failed_${initRes.status}`);
          const { assetId, uploadUrl } = (await initRes.json()) as {
            assetId: string;
            uploadUrl: string;
          };
          updateItem(item.id, { assetId });

          const handle = putWithProgress(uploadUrl, item.file, contentType, (pct) =>
            updateItem(item.id, { progress: pct }),
          );
          updateItem(item.id, { xhr: handle.xhr });
          await handle.promise;
          updateItem(item.id, { xhr: null, status: "done", progress: 100 });
        } else if (item.fileType === "note") {
          const controller = new AbortController();
          updateItem(item.id, { controller });
          const form = new FormData();
          form.set("libraryId", String(libraryId));
          form.set("folderPath", folderPath);
          if (folderId) form.set("folderId", folderId);
          form.set("file", item.file);
          const res = await fetch("/api/notes/from-file", {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`note_upload_failed_${res.status}`);
          updateItem(item.id, { controller: null, status: "done", progress: 100 });
        } else if (item.fileType === "reference") {
          const controller = new AbortController();
          updateItem(item.id, { controller });
          const form = new FormData();
          form.set("libraryId", String(libraryId));
          form.set("folderPath", folderPath);
          if (folderId) form.set("folderId", folderId);
          form.set("file", item.file);
          const res = await fetch("/api/references/from-bib", {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`ref_upload_failed_${res.status}`);
          const result = (await res.json()) as { created: number; skipped: number };
          updateItem(item.id, { controller: null, status: "done", progress: 100 });
          if (result.skipped > 0) {
            toast.info(`${result.created} created, ${result.skipped} skipped (duplicate keys)`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload_failed";
        // Distinguish user-cancellation from real failure.
        const isAbort =
          msg === "cancelled" ||
          (err instanceof DOMException && err.name === "AbortError");
        if (isAbort) {
          // Cancel handler already updated status; nothing more to do.
          return;
        }
        updateItem(item.id, { status: "failed", error: msg, xhr: null, controller: null });
        toast.error(`Failed: ${item.file.name}`, { description: msg });
      }
    },
    [libraryId, folderPath, folderId, updateItem],
  );

  const cancelItem = useCallback(
    (id: string) => {
      // Read the latest item from the updater (React may defer the updater
      // body, so we run side-effects from inside it), then return the
      // cancelled state. Side-effects are idempotent: aborting an already-
      // settled XHR is a noop, and DELETE failures are swallowed.
      setItems((prev) => {
        const snapshot = prev.find((it) => it.id === id);
        if (!snapshot) return prev;
        try {
          snapshot.xhr?.abort();
        } catch {
          /* noop */
        }
        try {
          snapshot.controller?.abort();
        } catch {
          /* noop */
        }
        if (snapshot.paperId) {
          fetch(`/api/papers/${snapshot.paperId}`, { method: "DELETE" }).catch(() => {});
        }
        if (snapshot.assetId) {
          fetch(`/api/assets/${snapshot.assetId}`, { method: "DELETE" }).catch(() => {});
        }
        return prev.map((it) =>
          it.id === id
            ? { ...it, status: "cancelled", xhr: null, controller: null }
            : it,
        );
      });
    },
    [],
  );

  const retryItem = useCallback(
    (id: string) => {
      // Read the latest item from inside the updater (React may defer it),
      // reset its status, and kick off processing from there. This avoids
      // depending on a closure-captured `items` array.
      setItems((prev) => {
        const snapshot = prev.find((it) => it.id === id);
        if (!snapshot) return prev;
        const reset: UploadItem = {
          ...snapshot,
          status: "queued",
          progress: 0,
          error: undefined,
          xhr: null,
          controller: null,
          paperId: null,
          assetId: null,
        };
        void processFile(reset);
        return prev.map((it) => (it.id === id ? reset : it));
      });
    },
    [processFile],
  );

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const toProcess: UploadItem[] = [];
      const summary = { papers: 0, notes: 0, references: 0, images: 0 };

      for (const file of accepted) {
        const fileType = detectFileType(file);

        if (fileType === "unknown") {
          toast.error(`Unsupported file: ${file.name}`);
          continue;
        }

        if (fileType === "data") {
          toast.info("Data file uploads coming in Phase 1.3.x");
          continue;
        }

        // Size checks
        const maxBytes =
          fileType === "paper"
            ? MAX_PDF_BYTES
            : fileType === "image"
              ? MAX_ASSET_BYTES
              : MAX_TEXT_BYTES;
        if (file.size > maxBytes) {
          const limit =
            fileType === "paper" || fileType === "image" ? "50 MB" : "5 MB";
          toast.error(`${file.name} exceeds ${limit}`);
          continue;
        }

        const item: UploadItem = {
          id: `${Date.now()}-${counterRef.current++}`,
          file,
          fileType,
          status: "queued",
          progress: 0,
        };
        toProcess.push(item);
        if (fileType === "paper") summary.papers++;
        else if (fileType === "note") summary.notes++;
        else if (fileType === "reference") summary.references++;
        else if (fileType === "image") summary.images++;
      }

      if (toProcess.length === 0) return;

      setItems((prev) => [...prev, ...toProcess]);

      // Process 3 at a time
      for (let i = 0; i < toProcess.length; i += 3) {
        await Promise.all(toProcess.slice(i, i + 3).map(processFile));
      }

      router.refresh();

      const parts: string[] = [];
      if (summary.papers > 0) parts.push(`${summary.papers} paper${summary.papers > 1 ? "s" : ""}`);
      if (summary.notes > 0) parts.push(`${summary.notes} note${summary.notes > 1 ? "s" : ""}`);
      if (summary.references > 0) parts.push(`${summary.references} reference file${summary.references > 1 ? "s" : ""}`);
      if (summary.images > 0) parts.push(`${summary.images} image${summary.images > 1 ? "s" : ""}`);
      if (parts.length > 0) {
        toast.success(`Uploaded ${parts.join(", ")}`);
      }
    },
    [processFile, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/markdown": [".md", ".markdown"],
      "text/plain": [".txt"],
      "application/x-bibtex": [".bib"],
      "text/csv": [".csv"],
      "application/json": [".json"],
      "text/tab-separated-values": [".tsv"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/gif": [".gif"],
      "image/webp": [".webp"],
      "image/svg+xml": [".svg"],
    },
    multiple: true,
    noClick: false,
  });

  const clearFinished = useCallback(() => {
    setItems((prev) =>
      prev.filter(
        (it) =>
          it.status !== "done" &&
          it.status !== "failed" &&
          it.status !== "cancelled",
      ),
    );
  }, []);

  const hasFinished = items.some(
    (it) => it.status === "done" || it.status === "failed" || it.status === "cancelled",
  );

  const typeLabel: Record<FileType, string> = {
    paper: "PDF",
    note: "Note",
    reference: "BibTeX",
    data: "Data",
    image: "Image",
    unknown: "Unknown",
  };

  return (
    <div className="mb-6">
      <div
        {...getRootProps()}
        role="presentation"
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center transition-colors hover:border-border hover:bg-muted/40",
          isDragActive && "border-border bg-muted/60",
        )}
      >
        <input {...getInputProps()} />
        <p className="font-display text-sm">
          {isDragActive ? "Drop files here" : "Drop files or click to upload"}
        </p>
        <p className="mt-1 text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
          PDF · MD · BibTeX · Images · up to 50 MB
        </p>
      </div>

      {items.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {items.map((it) => {
            const canCancel = it.status === "queued" || it.status === "uploading";
            const canRetry = it.status === "failed";
            return (
              <div
                key={it.id}
                className="flex w-full items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm">{it.file.name}</p>
                    <span className="shrink-0 text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
                      {typeLabel[it.fileType]} · {it.status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {it.status === "done" ? (
                      <span className="flex flex-1 items-center gap-1 text-[11px] text-muted-foreground">
                        <CheckIcon className="h-3 w-3" aria-hidden /> Uploaded
                      </span>
                    ) : (
                      <div
                        role="progressbar"
                        aria-valuenow={it.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${it.file.name} ${it.status}`}
                        className="h-1 flex-1 overflow-hidden rounded-sm bg-muted"
                      >
                        <div
                          className={cn(
                            "h-full transition-all",
                            it.status === "failed" || it.status === "cancelled"
                              ? "bg-destructive"
                              : "bg-foreground/70",
                          )}
                          style={{ width: `${it.progress}%` }}
                        />
                      </div>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {humanSize(it.file.size)}
                    </span>
                  </div>
                  {it.status === "failed" && it.error && (
                    <p className="mt-1 text-xs text-destructive">{it.error}</p>
                  )}
                </div>
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => cancelItem(it.id)}
                    aria-label={`Cancel ${it.file.name}`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                {canRetry && (
                  <button
                    type="button"
                    onClick={() => retryItem(it.id)}
                    aria-label={`Retry ${it.file.name}`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
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
