"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type Accept } from "react-dropzone";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { showSignInToUpload } from "@/lib/upload-gate";
import { useSession } from "@episteme/auth/client";
import {
  resolveChain,
  breadcrumbFromChain,
  type FolderRow,
} from "@/lib/folders";
import { FolderDestinationPicker } from "./FolderDestinationPicker";
import { invalidateTree } from "@/lib/tree-invalidate";

export type DetailUploadKind = "paper" | "note" | "reference";

const PAPER_ACCEPT: Accept = {
  "application/pdf": [".pdf"],
};
const NOTE_ACCEPT: Accept = {
  "text/markdown": [".md", ".markdown"],
};
const REF_ACCEPT: Accept = {
  "application/x-bibtex": [".bib"],
  "application/x-research-info-systems": [".ris"],
  "application/json": [".json"],
};

const ACCEPT_BY_KIND: Record<DetailUploadKind, Accept> = {
  paper: PAPER_ACCEPT,
  note: NOTE_ACCEPT,
  reference: REF_ACCEPT,
};

const REJECT_MSG_BY_KIND: Record<DetailUploadKind, string> = {
  paper: "Only PDF files are supported here.",
  note: "Only Markdown (.md, .markdown) files are supported here.",
  reference: "Only BibTeX (.bib), RIS (.ris), or CSL JSON (.json) are supported here.",
};

const LABEL_BY_KIND: Record<DetailUploadKind, string> = {
  paper: "Upload PDF",
  note: "Upload Markdown",
  reference: "Import .bib / .ris / .json",
};

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

interface DetailUploadBarProps {
  kind: DetailUploadKind;
  libraryId: number;
  folders: FolderRow[];
  /** Initial selected folder. `null` means library root. */
  defaultFolderId: string | null;
  isAnonymous?: boolean;
}

function folderPathFor(
  folders: FolderRow[],
  folderId: string | null,
): string {
  if (!folderId) return "";
  const chain = resolveChain(folders, folderId);
  return chain.map((f) => f.name).join("/");
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_failed_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.send(file);
  });
}

export function DetailUploadBar({
  kind,
  libraryId,
  folders,
  defaultFolderId,
  isAnonymous: isAnonymousProp,
}: DetailUploadBarProps) {
  const router = useRouter();
  const session = useSession();
  const sessionIsAnon =
    (session.data?.user as { isAnonymous?: boolean } | undefined)
      ?.isAnonymous ?? false;
  const isAnonymous = isAnonymousProp ?? sessionIsAnon;

  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [busy, setBusy] = useState(false);
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;

  const uploadOne = useCallback(
    async (file: File): Promise<void> => {
      const currentFolderId = folderIdRef.current;
      const folderPath = folderPathFor(folders, currentFolderId);

      if (kind === "paper") {
        if (file.size > MAX_PDF_BYTES) {
          toast.error(`${file.name} exceeds 50 MB`);
          return;
        }
        const initRes = await fetch("/api/papers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            libraryId,
            folderPath,
            ...(currentFolderId ? { folderId: currentFolderId } : {}),
            filename: file.name,
            contentType: "application/pdf",
            sizeBytes: file.size,
          }),
        });
        if (!initRes.ok) throw new Error(`init_failed_${initRes.status}`);
        const { paperId, uploadUrl } = (await initRes.json()) as {
          paperId: string;
          uploadUrl: string;
        };
        if (uploadUrl) {
          await putWithProgress(uploadUrl, file, "application/pdf");
        }
        const finRes = await fetch(`/api/papers/${paperId}/finalize`, {
          method: "POST",
        });
        if (!finRes.ok) throw new Error(`finalize_failed_${finRes.status}`);
        toast.success(`Uploaded ${file.name}`, {
          action: {
            label: "Open",
            onClick: () => router.push(`/p/${paperId}`),
          },
        });
        return;
      }

      if (kind === "note") {
        if (file.size > MAX_TEXT_BYTES) {
          toast.error(`${file.name} exceeds 5 MB`);
          return;
        }
        const form = new FormData();
        form.set("libraryId", String(libraryId));
        form.set("folderPath", folderPath);
        if (currentFolderId) form.set("folderId", currentFolderId);
        form.set("file", file);
        const res = await fetch("/api/notes/from-file", {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(`note_upload_failed_${res.status}`);
        const row = (await res.json()) as { slug?: string; title?: string };
        toast.success(`Imported ${row.title ?? file.name}`, {
          action: row.slug
            ? {
                label: "Open",
                onClick: () =>
                  router.push(`/n/${encodeURIComponent(row.slug as string)}`),
              }
            : undefined,
        });
        return;
      }

      // reference
      if (file.size > MAX_TEXT_BYTES) {
        toast.error(`${file.name} exceeds 5 MB`);
        return;
      }
      const form = new FormData();
      form.set("libraryId", String(libraryId));
      form.set("folderPath", folderPath);
      if (currentFolderId) form.set("folderId", currentFolderId);
      form.set("file", file);
      const res = await fetch("/api/references/import", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`ref_import_failed_${res.status}`);
      const result = (await res.json()) as {
        imported: number;
        skipped: number;
      };
      const parts = [`${result.imported} imported`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      toast.success(parts.join(", "));
    },
    [folders, kind, libraryId, router],
  );

  const onDrop = useCallback(
    async (accepted: File[], rejected: readonly unknown[]) => {
      if (isAnonymous) {
        showSignInToUpload();
        return;
      }
      if (rejected.length > 0) {
        toast.error(REJECT_MSG_BY_KIND[kind]);
      }
      if (accepted.length === 0) return;
      setBusy(true);
      try {
        for (const file of accepted) {
          try {
            await uploadOne(file);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "upload_failed";
            toast.error(`Failed: ${file.name}`, { description: msg });
          }
        }
      } finally {
        setBusy(false);
        router.refresh();
        invalidateTree();
      }
    },
    [isAnonymous, kind, router, uploadOne],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPT_BY_KIND[kind],
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground transition-colors",
        isDragActive && "border-border bg-muted/60",
      )}
    >
      <input
        {...getInputProps()}
        data-testid="detail-upload-input"
      />
      <button
        type="button"
        onClick={open}
        disabled={busy}
        data-testid="detail-upload-button"
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      >
        <UploadCloud className="size-3.5 opacity-70" aria-hidden />
        {busy ? "Uploading…" : LABEL_BY_KIND[kind]}
      </button>
      <span aria-hidden>→</span>
      <FolderDestinationPicker
        folders={folders}
        value={folderId}
        onChange={setFolderId}
        triggerTestId="detail-upload-folder-trigger"
      />
      <span className="ml-auto text-[11px] text-muted-foreground">
        {isDragActive ? "Drop file" : "or drop a file here"}
      </span>
    </div>
  );
}
