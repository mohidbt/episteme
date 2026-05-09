"use client";

/**
 * #21 — custom <pre> renderer for Streamdown markdown in agent chat. Replaces
 * Streamdown's built-in copy/download toolbar with our own:
 *   - Copy: writes the raw code to clipboard.
 *   - Add to library: POSTs the markdown code block to /api/notes and opens
 *     the new note in a new tab.
 *
 * Streamdown's default `pre` is:
 *   ({children}) => cloneElement(children, {"data-block":"true"})
 * The `data-block` marker is what tells Streamdown's `code` component to
 * render the syntax-highlighted block UI. We preserve that, but disable
 * Streamdown's internal `controls` so its native toolbar is hidden, and wrap
 * the result in a positioned container with our own buttons.
 */

import { CheckIcon, CopyIcon, BookmarkPlusIcon } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

interface ChatCodePreProps {
  children?: ReactNode;
}

/** Walk a React node tree and concatenate all string text. */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    return extractText(children);
  }
  return "";
}

/** Try to derive a title from the first markdown heading in a code block. */
function deriveTitle(code: string): string {
  const headingMatch = code.match(/^\s*#{1,6}\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim().slice(0, 60);
  }
  const firstLine = code.split("\n").find((l) => l.trim().length > 0);
  if (firstLine) return firstLine.trim().slice(0, 60);
  return "Saved from chat";
}

interface CreateNoteOpts {
  contentMd: string;
  title: string;
}

/**
 * POST to /api/notes. Resolves to the new note's slug on success, null
 * otherwise. Exported for testability.
 */
export async function createNoteFromChat(
  opts: CreateNoteOpts,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  // Discover user's default library (libraryId is required by the schema).
  // The /api/notes GET endpoint without libraryId returns validation error
  // for cookie auth, so we hit /api/libraries first.
  const libRes = await fetchImpl("/api/libraries", {
    credentials: "include",
    cache: "no-store",
  });
  if (!libRes.ok) return null;
  const libs = (await libRes.json()) as Array<{ id: number }>;
  const libraryId = libs[0]?.id;
  if (typeof libraryId !== "number") return null;
  const res = await fetchImpl("/api/notes", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      libraryId,
      title: opts.title,
      contentMd: opts.contentMd,
      noteType: "md",
    }),
  });
  if (!res.ok) return null;
  const note = (await res.json()) as { slug?: string };
  return note.slug ?? null;
}

export function ChatCodePre({ children }: ChatCodePreProps) {
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const codeRef = useRef<HTMLDivElement | null>(null);

  // Streamdown forwards a single <code> element. Mark it with `data-block`
  // so Streamdown's internal renderer treats it as a block-level highlighted
  // code box (without `data-block` it falls back to inline rendering).
  const child =
    isValidElement(children) && children.type !== undefined
      ? cloneElement(
          children as ReactElement,
          // `data-block` is the marker Streamdown's internal `code` component
          // looks for to decide whether to render block vs inline highlighting.
          { "data-block": "true" } as Record<string, unknown>,
        )
      : children;

  const onCopy = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      toast.error("Clipboard API not available");
      return;
    }
    const text = extractText(children);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  }, [children]);

  const onAdd = useCallback(async () => {
    if (adding) return;
    setAdding(true);
    const code = extractText(children);
    const title = deriveTitle(code);
    try {
      const slug = await createNoteFromChat({ contentMd: code, title });
      if (!slug) {
        toast.error("Failed to add to library");
        return;
      }
      toast.success("Added to library");
      window.open(`/n/${slug}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[ChatCodePre] add to library failed:", err);
      toast.error(`Failed to add to library: ${detail}`);
    } finally {
      setAdding(false);
    }
  }, [children, adding]);

  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <div ref={codeRef} className="group/code-block relative my-2">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border bg-background/80 p-0.5 shadow-sm opacity-0 transition-opacity group-hover/code-block:opacity-100">
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy code"
          title="Copy code"
          data-testid="chat-code-copy"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add to library"
          title="Add to library"
          data-testid="chat-code-add-to-library"
          disabled={adding}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <BookmarkPlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {child}
    </div>
  );
}
