"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TEXT_BYTES = 5 * 1024 * 1024; // 5 MB

type FileType = "paper" | "note" | "reference" | "data" | "unknown";
type UploadStatus = "queued" | "uploading" | "done" | "failed";

interface UploadItem {
  id: string;
  file: File;
  fileType: FileType;
  status: UploadStatus;
  progress: number;
  error?: string;
}

interface UnifiedDropzoneProps {
  libraryId: number;
  folderPath: string;
  folderId?: string | null;
}

function detectFileType(file: File): FileType {
  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  if (ext === "pdf") return "paper";
  if (["md", "markdown", "txt"].includes(ext)) return "note";
  if (ext === "bib") return "reference";
  if (["csv", "json", "tsv"].includes(ext)) return "data";
  return "unknown";
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
    xhr.setRequestHeader("Content-Type", "application/pdf");
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

async function uploadPaper(
  file: File,
  libraryId: number,
  folderPath: string,
  folderId: string | null | undefined,
  onProgress: (pct: number) => void,
): Promise<string> {
  const initRes = await fetch("/api/papers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      libraryId,
      folderPath,
      ...(folderId != null ? { folderId } : {}),
      filename: file.name,
      contentType: "application/pdf",
      sizeBytes: file.size,
    }),
  });
  if (!initRes.ok) throw new Error(`init_failed_${initRes.status}`);
  const { paperId, uploadUrl } = (await initRes.json()) as { paperId: string; uploadUrl: string };

  await putWithProgress(uploadUrl, file, onProgress);

  const finRes = await fetch(`/api/papers/${paperId}/finalize`, { method: "POST" });
  if (!finRes.ok) throw new Error(`finalize_failed_${finRes.status}`);
  return paperId;
}

async function uploadNote(
  file: File,
  libraryId: number,
  folderPath: string,
  folderId: string | null | undefined,
): Promise<void> {
  const form = new FormData();
  form.set("libraryId", String(libraryId));
  form.set("folderPath", folderPath);
  if (folderId) form.set("folderId", folderId);
  form.set("file", file);
  const res = await fetch("/api/notes/from-file", { method: "POST", body: form });
  if (!res.ok) throw new Error(`note_upload_failed_${res.status}`);
}

async function uploadReference(
  file: File,
  libraryId: number,
  folderPath: string,
  folderId: string | null | undefined,
): Promise<{ created: number; skipped: number }> {
  const form = new FormData();
  form.set("libraryId", String(libraryId));
  form.set("folderPath", folderPath);
  if (folderId) form.set("folderId", folderId);
  form.set("file", file);
  const res = await fetch("/api/references/from-bib", { method: "POST", body: form });
  if (!res.ok) throw new Error(`ref_upload_failed_${res.status}`);
  return res.json();
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

  const processFile = useCallback(
    async (item: UploadItem) => {
      updateItem(item.id, { status: "uploading" });
      try {
        if (item.fileType === "paper") {
          await uploadPaper(item.file, libraryId, folderPath, folderId, (pct) =>
            updateItem(item.id, { progress: pct }),
          );
          updateItem(item.id, { status: "done", progress: 100 });
        } else if (item.fileType === "note") {
          await uploadNote(item.file, libraryId, folderPath, folderId);
          updateItem(item.id, { status: "done", progress: 100 });
        } else if (item.fileType === "reference") {
          const result = await uploadReference(item.file, libraryId, folderPath, folderId);
          updateItem(item.id, { status: "done", progress: 100 });
          if (result.skipped > 0) {
            toast.info(`${result.created} created, ${result.skipped} skipped (duplicate keys)`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload_failed";
        updateItem(item.id, { status: "failed", error: msg });
        toast.error(`Failed: ${item.file.name}`, { description: msg });
      }
    },
    [libraryId, folderPath, folderId, updateItem],
  );

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const toProcess: UploadItem[] = [];
      const summary = { papers: 0, notes: 0, references: 0 };

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
        const maxBytes = fileType === "paper" ? MAX_PDF_BYTES : MAX_TEXT_BYTES;
        if (file.size > maxBytes) {
          const limit = fileType === "paper" ? "50 MB" : "5 MB";
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
    },
    multiple: true,
    noClick: false,
  });

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== "done" && it.status !== "failed"));
  }, []);

  const hasFinished = items.some((it) => it.status === "done" || it.status === "failed");

  const typeLabel: Record<FileType, string> = {
    paper: "PDF",
    note: "Note",
    reference: "BibTeX",
    data: "Data",
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
          PDF · MD · BibTeX · up to 50 MB for PDFs, 5 MB otherwise
        </p>
      </div>

      {items.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {items.map((it) => (
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
                        it.status === "failed" ? "bg-destructive" : "bg-foreground/70",
                      )}
                      style={{ width: `${it.progress}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {humanSize(it.file.size)}
                  </span>
                </div>
                {it.status === "failed" && it.error && (
                  <p className="mt-1 text-xs text-destructive">{it.error}</p>
                )}
              </div>
            </div>
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
