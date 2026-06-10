"use client";

import { useCallback, useRef, useState } from "react";
import { PaperclipIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

// Mirror of /api/assets ALLOWLIST (apps/km/src/lib/validators.ts). Keep in
// sync — wider client list will produce 400 from /api/assets.
const SUPPORTED_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

export interface ChatAttachment {
  id: string;
  file: File;
  /** assetId once uploaded */
  assetId: string | null;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

function isSupported(file: File): boolean {
  return SUPPORTED_MIME.has(file.type);
}

/**
 * Hook: manages chat-input attachments list + drag/drop + paperclip add.
 * Caller is responsible for rendering the chips and calling `uploadAll()`
 * before sending the message.
 */
export function useChatAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const addFiles = useCallback((files: File[] | FileList) => {
    const arr = Array.from(files);
    const accepted: ChatAttachment[] = [];
    for (const f of arr) {
      if (!isSupported(f)) {
        toast.error(`Unsupported file type: ${f.name}`);
        continue;
      }
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        assetId: null,
        status: "queued",
      });
    }
    if (accepted.length) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  /**
   * Upload every queued attachment via the two-step /api/assets flow.
   * Returns the final attachments list with assetIds populated.
   * Rejects (returns null) if any upload fails.
   */
  const uploadAll = useCallback(async (): Promise<ChatAttachment[] | null> => {
    if (attachments.length === 0) return [];

    // Resolve default library (one-library-per-user invariant).
    const libRes = await fetch("/api/libraries", {
      credentials: "include",
      cache: "no-store",
    });
    if (!libRes.ok) {
      toast.error("Could not resolve library for upload");
      return null;
    }
    const libs = (await libRes.json()) as Array<{ id: number }>;
    const libraryId = libs[0]?.id;
    if (typeof libraryId !== "number") {
      toast.error("No library available for attachment upload");
      return null;
    }

    const results: ChatAttachment[] = [];
    for (const att of attachments) {
      if (att.status === "done" && att.assetId) {
        results.push(att);
        continue;
      }
      try {
        const initRes = await fetch("/api/assets", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            libraryId,
            filename: att.file.name,
            contentType: att.file.type,
            sizeBytes: att.file.size,
          }),
        });
        if (!initRes.ok) throw new Error(`init_${initRes.status}`);
        const { assetId, uploadUrl } = (await initRes.json()) as {
          assetId: string;
          uploadUrl: string;
        };
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": att.file.type },
          body: att.file,
        });
        if (!putRes.ok) throw new Error(`put_${putRes.status}`);
        results.push({ ...att, assetId, status: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload_failed";
        toast.error(`Failed to upload ${att.file.name}`, { description: msg });
        return null;
      }
    }
    setAttachments(results);
    return results;
  }, [attachments]);

  return { attachments, addFiles, removeAttachment, clear, uploadAll };
}

/**
 * Build the user-message text with attachment markers appended.
 * Format: `[Attached file: <name> (assetId=<id>)]`
 * Agent-side resolver reads assetId and fetches the asset content.
 */
export function formatMessageWithAttachments(
  text: string,
  uploaded: ChatAttachment[],
): string {
  if (uploaded.length === 0) return text;
  const tags = uploaded
    .filter((a) => a.assetId)
    .map((a) => `[Attached file: ${a.file.name} (assetId=${a.assetId})]`)
    .join(" ");
  if (!tags) return text;
  return text.trim().length === 0 ? tags : `${text}\n\n${tags}`;
}

export interface AttachmentChipsProps {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}

export function AttachmentChips({ attachments, onRemove }: AttachmentChipsProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2" data-testid="chat-attachment-chips">
      {attachments.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
        >
          <span className="truncate max-w-[160px]" title={a.file.name}>
            {a.file.name}
          </span>
          <button
            type="button"
            aria-label={`Remove ${a.file.name}`}
            onClick={() => onRemove(a.id)}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export interface PaperclipButtonProps {
  onFiles: (files: FileList | File[]) => void;
}

export function PaperclipButton({ onFiles }: PaperclipButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach file"
        onClick={() => inputRef.current?.click()}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <PaperclipIcon className="size-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        data-testid="chat-file-input"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </>
  );
}
