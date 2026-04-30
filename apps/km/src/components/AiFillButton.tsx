"use client";

// G17 — Per-row "fill missing" action.
// Posts known fields + missing field names to /api/ai-fill, shows the preview
// inside a confirm() dialog (one-time, no auto-apply), and on accept calls
// the supplied PATCH path. Wand2 icon per G3 convention.
import { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  /** Endpoint that PATCHes accepted suggestions (e.g. `/api/papers/ID`). */
  patchUrl: string;
  /** "paper" or "reference" — used in the prompt. */
  kind: "paper" | "reference";
  /** Known field values for the row. */
  known: Record<string, unknown>;
  /** Missing fields the LLM should fill. Empty = button disabled. */
  missing: string[];
  /** Optional label override for screen readers. */
  ariaLabel?: string;
  /** Optional CSS classes appended to the button. */
  className?: string;
}

export function AiFillButton({
  patchUrl,
  kind,
  known,
  missing,
  ariaLabel,
  className,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const disabled = missing.length === 0 || busy;

  async function onClick() {
    if (disabled) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, known, missing }),
      });
      if (!res.ok) {
        toast.error("AI fill failed", { description: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as { suggestions: Record<string, unknown> };
      const suggestions = data.suggestions ?? {};
      const keys = Object.keys(suggestions);
      if (keys.length === 0) {
        toast.message("No suggestions returned");
        return;
      }
      const previewLines = keys.map((k) => `${k}: ${formatValue(suggestions[k])}`).join("\n");
      const ok = window.confirm(`Apply these suggestions?\n\n${previewLines}`);
      if (!ok) return;

      const patch = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suggestions),
      });
      if (!patch.ok) {
        toast.error("Apply failed", { description: `HTTP ${patch.status}` });
        return;
      }
      toast.success("Filled");
      router.refresh();
    } catch {
      toast.error("AI fill failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? `Fill missing fields with AI`}
      data-testid="ai-fill-button"
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        disabled && "pointer-events-none opacity-30",
        className,
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <Wand2 aria-hidden className="size-3.5" />
      )}
    </button>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v == null) return "";
  return String(v);
}
